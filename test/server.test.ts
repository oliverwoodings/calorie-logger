import { describe, it, expect, beforeEach } from "vitest";
import { buildServer } from "../src/server.js";
import { createMemoryStorage } from "../src/storage.js";

const AUTH = "test-secret";

describe("server", () => {
  let app: ReturnType<typeof buildServer>;

  beforeEach(() => {
    app = buildServer({ authToken: AUTH, storage: createMemoryStorage() });
  });

  it("rejects requests without auth header", async () => {
    const res = await app.inject({ method: "GET", url: "/summary?date=2026-02-03" });
    expect(res.statusCode).toBe(401);
  });

  it("logs and summarizes entries", async () => {
    const logRes = await app.inject({
      method: "POST",
      url: "/log",
      headers: { "x-auth-token": AUTH },
      payload: {
        date: "2026-02-03",
        meal_type: "breakfast",
        items: [{ name: "Banana", calories: 105 }]
      }
    });

    expect(logRes.statusCode).toBe(200);
    const logBody = logRes.json();
    expect(logBody.total_calories).toBe(105);
    expect(logBody.entry_ids.length).toBe(1);

    const summaryRes = await app.inject({
      method: "GET",
      url: "/summary?date=2026-02-03",
      headers: { "x-auth-token": AUTH }
    });
    expect(summaryRes.statusCode).toBe(200);
    expect(summaryRes.json().total_calories).toBe(105);
  });

  it("lists entries with limit", async () => {
    await app.inject({
      method: "POST",
      url: "/log",
      headers: { "x-auth-token": AUTH },
      payload: {
        date: "2026-02-03",
        meal_type: "lunch",
        items: [
          { name: "Banana", calories: 105 },
          { name: "Apple", calories: 95 }
        ]
      }
    });

    const listRes = await app.inject({
      method: "GET",
      url: "/list?date=2026-02-03&limit=1&offset=0",
      headers: { "x-auth-token": AUTH }
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().entries.length).toBe(1);
  });

  it("returns summary range with empty days", async () => {
    await app.inject({
      method: "POST",
      url: "/log",
      headers: { "x-auth-token": AUTH },
      payload: {
        date: "2026-02-03",
        meal_type: "breakfast",
        items: [{ name: "Banana", calories: 105 }]
      }
    });

    const rangeRes = await app.inject({
      method: "GET",
      url: "/summary-range?start=2026-02-02&end=2026-02-04&include_empty=true",
      headers: { "x-auth-token": AUTH }
    });

    expect(rangeRes.statusCode).toBe(200);
    const body = rangeRes.json();
    expect(body.totals.length).toBe(3);
    const day = body.totals.find((item: { date: string }) => item.date === "2026-02-03");
    expect(day.total_calories).toBe(105);
  });

  it("returns summary range grouped by meal type", async () => {
    await app.inject({
      method: "POST",
      url: "/log",
      headers: { "x-auth-token": AUTH },
      payload: {
        date: "2026-02-03",
        meal_type: "lunch",
        items: [{ name: "Sandwich", calories: 300 }]
      }
    });

    const rangeRes = await app.inject({
      method: "GET",
      url: "/summary-range?start=2026-02-03&end=2026-02-03&group=meal_type",
      headers: { "x-auth-token": AUTH }
    });

    expect(rangeRes.statusCode).toBe(200);
    const body = rangeRes.json();
    expect(body.group).toBe("meal_type");
    expect(body.totals[0].totals.lunch).toBe(300);
  });

  it("lists entries in a range", async () => {
    await app.inject({
      method: "POST",
      url: "/log",
      headers: { "x-auth-token": AUTH },
      payload: {
        date: "2026-02-01",
        meal_type: "breakfast",
        items: [{ name: "Toast", calories: 200 }]
      }
    });

    await app.inject({
      method: "POST",
      url: "/log",
      headers: { "x-auth-token": AUTH },
      payload: {
        date: "2026-02-03",
        meal_type: "dinner",
        items: [{ name: "Soup", calories: 150 }]
      }
    });

    const rangeRes = await app.inject({
      method: "GET",
      url: "/entries-range?start=2026-02-01&end=2026-02-03&limit=10&offset=0",
      headers: { "x-auth-token": AUTH }
    });

    expect(rangeRes.statusCode).toBe(200);
    expect(rangeRes.json().entries.length).toBe(2);
  });

  it("updates an entry and totals", async () => {
    const logRes = await app.inject({
      method: "POST",
      url: "/log",
      headers: { "x-auth-token": AUTH },
      payload: {
        date: "2026-02-03",
        meal_type: "dinner",
        items: [{ name: "Pasta", calories: 400 }]
      }
    });

    const entryId = logRes.json().entry_ids[0];
    const updateRes = await app.inject({
      method: "POST",
      url: "/update",
      headers: { "x-auth-token": AUTH },
      payload: {
        entry_id: entryId,
        updates: { calories: 450 }
      }
    });

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().total_calories).toBe(450);
  });

  it("deletes an entry and updates totals", async () => {
    const logRes = await app.inject({
      method: "POST",
      url: "/log",
      headers: { "x-auth-token": AUTH },
      payload: {
        date: "2026-02-03",
        meal_type: "snacks",
        items: [{ name: "Cookie", calories: 200 }]
      }
    });

    const entryId = logRes.json().entry_ids[0];
    const deleteRes = await app.inject({
      method: "POST",
      url: "/delete",
      headers: { "x-auth-token": AUTH },
      payload: { entry_id: entryId }
    });

    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().total_calories).toBe(0);
  });
});
