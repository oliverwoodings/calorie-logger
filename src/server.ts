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

  app.get("/time", async () => ({ datetime: new Date().toISOString() }));

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

  app.get("/summary-range", async (request, reply) => {
    const auth = authCheck(request.headers as Record<string, string | undefined>);
    if (!auth.ok) {
      return reply.status(401).send(auth);
    }

    try {
      const query = request.query as Record<string, string | undefined>;
      const start = normalizeDate(requireField(query, "start"));
      const end = normalizeDate(requireField(query, "end"));
      const includeEmpty = String(query.include_empty || "").toLowerCase() === "true";
      const group = String(query.group || "").toLowerCase();

      if (group === "meal_type") {
        const entries = await options.storage.listEntriesRange(start, end, 10000, 0);
        const totalsByDate: Record<string, Record<string, number>> = {};
        for (const entry of entries) {
          const dateKey = entry.date;
          if (!totalsByDate[dateKey]) {
            totalsByDate[dateKey] = { breakfast: 0, lunch: 0, dinner: 0, snacks: 0 };
          }
          const meal = String(entry.meal_type || "");
          if (meal in totalsByDate[dateKey]) {
            totalsByDate[dateKey][meal] = numberOrZero(totalsByDate[dateKey][meal] + numberOrZero(entry.calories));
          }
        }

        const dates = includeEmpty ? enumerateDates_(start, end) : Object.keys(totalsByDate).sort();
        const totals = dates.map((date) => ({
          date,
          totals: totalsByDate[date] || { breakfast: 0, lunch: 0, dinner: 0, snacks: 0 }
        }));
        return reply.send({ start, end, totals, group: "meal_type" });
      }

      const totals = await options.storage.getTotalsRange(start, end);
      if (includeEmpty) {
        const map = new Map(totals.map((item) => [item.date, item.total_calories]));
        const filled = enumerateDates_(start, end).map((date) => ({
          date,
          total_calories: map.get(date) || 0
        }));
        return reply.send({ start, end, totals: filled });
      }

      return reply.send({ start, end, totals });
    } catch (err) {
      return reply.status(400).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/summary-last", async (request, reply) => {
    const auth = authCheck(request.headers as Record<string, string | undefined>);
    if (!auth.ok) {
      return reply.status(401).send(auth);
    }

    try {
      const query = request.query as Record<string, string | undefined>;
      const days = Number(query.days || 7);
      if (!Number.isFinite(days) || days <= 0) {
        throw new Error("days must be a positive number");
      }
      const includeEmpty = String(query.include_empty || "").toLowerCase() === "true";

      const end = formatLocalDate_(new Date());
      const start = formatLocalDate_(addDays_(new Date(), -(days - 1)));
      const totals = await options.storage.getTotalsRange(start, end);
      if (includeEmpty) {
        const map = new Map(totals.map((item) => [item.date, item.total_calories]));
        const filled = enumerateDates_(start, end).map((date) => ({
          date,
          total_calories: map.get(date) || 0
        }));
        return reply.send({ start, end, totals: filled });
      }

      return reply.send({ start, end, totals });
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

  app.get("/entries-range", async (request, reply) => {
    const auth = authCheck(request.headers as Record<string, string | undefined>);
    if (!auth.ok) {
      return reply.status(401).send(auth);
    }

    try {
      const query = request.query as Record<string, string | undefined>;
      const start = normalizeDate(requireField(query, "start"));
      const end = normalizeDate(requireField(query, "end"));
      const limit = Number(query.limit || 100);
      const offset = Number(query.offset || 0);
      const entries = await options.storage.listEntriesRange(start, end, limit, offset);
      return reply.send({ start, end, entries });
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

function enumerateDates_(start: string, end: string): string[] {
  const startDate = toDate_(start);
  const endDate = toDate_(end);
  if (startDate > endDate) {
    throw new Error("start must be before end");
  }

  const dates: string[] = [];
  const current = new Date(startDate.getTime());
  while (current <= endDate) {
    dates.push(formatLocalDate_(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function toDate_(value: string): Date {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }
  return date;
}

function formatLocalDate_(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays_(value: Date, days: number): Date {
  const date = new Date(value.getTime());
  date.setDate(date.getDate() + days);
  return date;
}
