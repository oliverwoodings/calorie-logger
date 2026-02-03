import Fastify from "fastify";
import { fingerprint, normalizeDate, numberOrZero, requireField, validateLogRequest, validateUpdateRequest } from "./lib.js";
import type { StorageAdapter } from "./storage.js";
import type { LogRequest, UpdateRequest, DeleteRequest } from "./types.js";

export interface ServerOptions {
  authToken: string;
  storage: StorageAdapter;
}

export function buildServer(options: ServerOptions) {
  const pretty = process.env.LOG_PRETTY === "1";
  const app = Fastify({
    logger: pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "HH:MM:ss",
              ignore: "pid,hostname"
            }
          }
        }
      : true
  });

  function authCheck(headers: Record<string, string | undefined>) {
    const provided = headers["x-auth-token"];
    if (!provided || provided !== options.authToken) {
      return {
        ok: false,
        error: "Unauthorized",
        auth: {
          provided: provided ? "present" : "missing",
          provided_fp: fingerprint(provided),
          expected_fp: fingerprint(options.authToken)
        }
      };
    }
    return { ok: true };
  }

  async function updateDailyTotal(date: string, delta: number) {
    await options.storage.incrementTotal(date, delta);
  }

  app.get("/health", async () => ({ ok: true }));

  app.get("/summary", async (request, reply) => {
    const auth = authCheck(request.headers as Record<string, string | undefined>);
    if (!auth.ok) {
      return reply.status(401).send(auth);
    }

    try {
      const query = request.query as Record<string, string | undefined>;
      const date = normalizeDate(requireField(query, "date"));
      const total = await options.storage.getTotal(date);
      return reply.send({ date, total_calories: total });
    } catch (err) {
      return reply.status(400).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/list", async (request, reply) => {
    const auth = authCheck(request.headers as Record<string, string | undefined>);
    if (!auth.ok) {
      return reply.status(401).send(auth);
    }

    try {
      const query = request.query as Record<string, string | undefined>;
      const date = normalizeDate(requireField(query, "date"));
      const limit = Number(query.limit || 100);
      const offset = Number(query.offset || 0);

      const entries = await options.storage.listEntries(date, limit, offset);
      return reply.send({ date, entries });
    } catch (err) {
      return reply.status(400).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/log", async (request, reply) => {
    const payload = request.body as LogRequest;
    const auth = authCheck(request.headers as Record<string, string | undefined>);
    if (!auth.ok) {
      return reply.status(401).send(auth);
    }

    try {
      const data = validateLogRequest(payload);
      const timestamp = new Date().toISOString();
      const entryIds: string[] = [];
      let delta = 0;

      const created = await options.storage.createEntries(
        data.items.map((item) => {
          delta += numberOrZero(item.calories);
          return {
            timestamp,
            date: data.date,
            meal_type: data.meal_type,
            item: item.name,
            quantity: item.quantity || "",
            calories: numberOrZero(item.calories),
            confidence: numberOrZero(item.confidence),
            source: String(data.source || ""),
            raw_text: String(data.raw_text || "")
          };
        })
      );

      created.forEach((entry) => entryIds.push(entry.entry_id));
      await updateDailyTotal(data.date, delta);

      const total = await options.storage.getTotal(data.date);
      return reply.send({ ok: true, date: data.date, total_calories: total, entry_ids: entryIds });
    } catch (err) {
      return reply.status(400).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/update", async (request, reply) => {
    const payload = request.body as UpdateRequest;
    const auth = authCheck(request.headers as Record<string, string | undefined>);
    if (!auth.ok) {
      return reply.status(401).send(auth);
    }

    try {
      const data = validateUpdateRequest(payload);
      const currentEntry = await options.storage.getEntry(data.entry_id);
      if (!currentEntry) {
        return reply.status(404).send({ ok: false, error: "entry_id not found" });
      }

      const newDate = data.updates.date || normalizeDate(currentEntry.date);
      const newMeal = data.updates.meal_type || String(currentEntry.meal_type || "");
      const newCalories = typeof data.updates.calories === "undefined" ? numberOrZero(currentEntry.calories) : numberOrZero(data.updates.calories);

      const updatePayload = {
        date: newDate,
        meal_type: newMeal,
        item: typeof data.updates.item === "undefined" ? String(currentEntry.item || "") : data.updates.item,
        quantity: typeof data.updates.quantity === "undefined" ? String(currentEntry.quantity || "") : data.updates.quantity,
        calories: newCalories,
        confidence: typeof data.updates.confidence === "undefined" ? numberOrZero(currentEntry.confidence) : numberOrZero(data.updates.confidence),
        source: typeof data.updates.source === "undefined" ? String(currentEntry.source || "") : data.updates.source,
        raw_text: typeof data.updates.raw_text === "undefined" ? String(currentEntry.raw_text || "") : data.updates.raw_text
      };

      await options.storage.updateEntry(data.entry_id, updatePayload);

      if (newDate !== normalizeDate(currentEntry.date)) {
        await updateDailyTotal(normalizeDate(currentEntry.date), -numberOrZero(currentEntry.calories));
        await updateDailyTotal(newDate, numberOrZero(newCalories));
      } else {
        const delta = numberOrZero(newCalories) - numberOrZero(currentEntry.calories);
        if (delta !== 0) {
          await updateDailyTotal(newDate, delta);
        }
      }

      const total = await options.storage.getTotal(newDate);
      return reply.send({ ok: true, entry_id: data.entry_id, date: newDate, total_calories: total });
    } catch (err) {
      return reply.status(400).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/delete", async (request, reply) => {
    const payload = request.body as DeleteRequest;
    const auth = authCheck(request.headers as Record<string, string | undefined>);
    if (!auth.ok) {
      return reply.status(401).send(auth);
    }

    try {
      const entryId = String(requireField(payload, "entry_id"));
      const currentEntry = await options.storage.getEntry(entryId);
      if (!currentEntry) {
        return reply.status(404).send({ ok: false, error: "entry_id not found" });
      }

      await options.storage.deleteEntry(entryId);
      await updateDailyTotal(normalizeDate(currentEntry.date), -numberOrZero(currentEntry.calories));

      const total = await options.storage.getTotal(normalizeDate(currentEntry.date));
      return reply.send({ ok: true, entry_id: entryId, date: normalizeDate(currentEntry.date), total_calories: total });
    } catch (err) {
      return reply.status(400).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return app;
}
