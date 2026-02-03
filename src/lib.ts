import type { MealType, LogItem, LogRequest, UpdateRequest, DeleteRequest } from "./types.js";

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snacks"];

export function normalizeDate(value: unknown): string {
  if (!value) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

export function normalizeMealType(value: unknown): MealType {
  const meal = String(value || "").toLowerCase().trim() as MealType;
  if (MEAL_TYPES.includes(meal)) {
    return meal;
  }
  throw new Error("Invalid meal_type. Use breakfast, lunch, dinner, or snacks.");
}

export function numberOrZero(value: unknown): number {
  const num = Number(value);
  if (Number.isNaN(num)) {
    return 0;
  }
  return Math.round(num * 100) / 100;
}

export function requireField<T extends object, K extends keyof T>(payload: T, key: K): T[K] {
  const value = payload[key];
  if (!value) {
    throw new Error(`Missing payload field: ${String(key)}`);
  }
  return value;
}

export function fingerprint(value?: string): string {
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return value;
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function validateLogRequest(payload: LogRequest): LogRequest {
  const date = normalizeDate(payload.date);
  const mealType = normalizeMealType(payload.meal_type);
  if (!payload.items || payload.items.length === 0) {
    throw new Error("items must be a non-empty array");
  }

  const items: LogItem[] = payload.items.map((item) => ({
    name: String(item.name || ""),
    quantity: item.quantity ? String(item.quantity) : "",
    calories: numberOrZero(item.calories),
    confidence: numberOrZero(item.confidence)
  }));

  return {
    ...payload,
    date,
    meal_type: mealType,
    items
  };
}

export function validateUpdateRequest(payload: UpdateRequest): UpdateRequest {
  const updates = payload.updates || {};
  return {
    entry_id: payload.entry_id,
    updates: {
      date: updates.date ? normalizeDate(updates.date) : undefined,
      meal_type: updates.meal_type ? normalizeMealType(updates.meal_type) : undefined,
      item: typeof updates.item === "undefined" ? undefined : String(updates.item),
      quantity: typeof updates.quantity === "undefined" ? undefined : String(updates.quantity),
      calories: typeof updates.calories === "undefined" ? undefined : numberOrZero(updates.calories),
      confidence: typeof updates.confidence === "undefined" ? undefined : numberOrZero(updates.confidence),
      source: typeof updates.source === "undefined" ? undefined : String(updates.source),
      raw_text: typeof updates.raw_text === "undefined" ? undefined : String(updates.raw_text)
    }
  };
}

export function validateDeleteRequest(payload: DeleteRequest): DeleteRequest {
  return { entry_id: payload.entry_id };
}
