import { describe, it, expect } from "vitest";
import { normalizeDate, normalizeMealType, numberOrZero, validateLogRequest, validateUpdateRequest } from "../src/lib.js";

describe("lib", () => {
  it("normalizes date strings", () => {
    expect(normalizeDate("2026-02-03")).toBe("2026-02-03");
  });

  it("normalizes Date objects", () => {
    const date = new Date("2026-02-03T12:00:00Z");
    expect(normalizeDate(date)).toBe("2026-02-03");
  });

  it("validates meal type", () => {
    expect(normalizeMealType("Breakfast")).toBe("breakfast");
  });

  it("rounds numbers", () => {
    expect(numberOrZero(10.126)).toBe(10.13);
  });

  it("validates log request", () => {
    const payload = validateLogRequest({
      date: "2026-02-03",
      meal_type: "lunch",
      items: [{ name: "Banana", calories: 105 }]
    });

    expect(payload.meal_type).toBe("lunch");
    expect(payload.items[0].calories).toBe(105);
  });

  it("validates update request", () => {
    const payload = validateUpdateRequest({
      entry_id: "abc",
      updates: { calories: 123.456, meal_type: "dinner" }
    });

    expect(payload.updates.calories).toBe(123.46);
    expect(payload.updates.meal_type).toBe("dinner");
  });
});
