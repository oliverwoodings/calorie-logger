export type MealType = "breakfast" | "lunch" | "dinner" | "snacks";

export interface LogItem {
  name: string;
  quantity?: string;
  calories: number;
  confidence?: number;
}

export interface LogRequest {
  date: string;
  meal_type: MealType;
  source?: string;
  raw_text?: string;
  items: LogItem[];
}

export interface UpdateRequest {
  entry_id: string;
  updates: {
    date?: string;
    meal_type?: MealType;
    item?: string;
    quantity?: string;
    calories?: number;
    confidence?: number;
    source?: string;
    raw_text?: string;
  };
}

export interface DeleteRequest {
  entry_id: string;
}
