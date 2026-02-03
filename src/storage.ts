import { Firestore, FieldValue } from "@google-cloud/firestore";
import { numberOrZero } from "./lib.js";

export interface EntryInput {
  timestamp: string;
  date: string;
  meal_type: string;
  item: string;
  quantity: string;
  calories: number;
  confidence: number;
  source: string;
  raw_text: string;
}

export interface Entry extends EntryInput {
  entry_id: string;
}

export interface StorageAdapter {
  createEntries(entries: EntryInput[]): Promise<Entry[]>;
  getEntry(entryId: string): Promise<Entry | null>;
  updateEntry(entryId: string, updates: Partial<EntryInput> & { date: string; meal_type: string }): Promise<void>;
  deleteEntry(entryId: string): Promise<Entry | null>;
  listEntries(date: string, limit: number, offset: number): Promise<Entry[]>;
  incrementTotal(date: string, delta: number): Promise<void>;
  getTotal(date: string): Promise<number>;
}

export function createFirestoreStorage(entriesCollection: string, totalsCollection: string): StorageAdapter {
  const db = new Firestore();

  return {
    async createEntries(entries) {
      const batch = db.batch();
      const created: Entry[] = [];

      for (const entry of entries) {
        const ref = db.collection(entriesCollection).doc();
        const withId = { ...entry, entry_id: ref.id };
        created.push(withId);
        batch.set(ref, withId);
      }

      await batch.commit();
      return created;
    },
    async getEntry(entryId) {
      const doc = await db.collection(entriesCollection).doc(entryId).get();
      return doc.exists ? (doc.data() as Entry) : null;
    },
    async updateEntry(entryId, updates) {
      await db.collection(entriesCollection).doc(entryId).update(updates);
    },
    async deleteEntry(entryId) {
      const ref = db.collection(entriesCollection).doc(entryId);
      const snap = await ref.get();
      if (!snap.exists) {
        return null;
      }
      const data = snap.data() as Entry;
      await ref.delete();
      return data;
    },
    async listEntries(date, limit, offset) {
      let query = db.collection(entriesCollection).where("date", "==", date).orderBy("timestamp", "desc");
      if (offset > 0) {
        query = query.offset(offset);
      }
      if (limit > 0) {
        query = query.limit(limit);
      }
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => doc.data() as Entry);
    },
    async incrementTotal(date, delta) {
      const ref = db.collection(totalsCollection).doc(date);
      await ref.set({ date, total_calories: FieldValue.increment(delta) }, { merge: true });
    },
    async getTotal(date) {
      const doc = await db.collection(totalsCollection).doc(date).get();
      return doc.exists ? numberOrZero(doc.data()?.total_calories) : 0;
    }
  };
}

export function createMemoryStorage(): StorageAdapter {
  const entries = new Map<string, Entry>();
  const totals = new Map<string, number>();
  let counter = 0;

  function nextId() {
    counter += 1;
    return `entry-${counter}`;
  }

  return {
    async createEntries(items) {
      const created = items.map((entry) => {
        const id = nextId();
        const full = { ...entry, entry_id: id };
        entries.set(id, full);
        return full;
      });
      return created;
    },
    async getEntry(entryId) {
      return entries.get(entryId) || null;
    },
    async updateEntry(entryId, updates) {
      const current = entries.get(entryId);
      if (!current) {
        return;
      }
      entries.set(entryId, { ...current, ...updates, entry_id: entryId });
    },
    async deleteEntry(entryId) {
      const current = entries.get(entryId);
      if (!current) {
        return null;
      }
      entries.delete(entryId);
      return current;
    },
    async listEntries(date, limit, offset) {
      const all = Array.from(entries.values())
        .filter((entry) => entry.date === date)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return all.slice(offset, offset + limit);
    },
    async incrementTotal(date, delta) {
      const current = totals.get(date) || 0;
      totals.set(date, numberOrZero(current + delta));
    },
    async getTotal(date) {
      return numberOrZero(totals.get(date) || 0);
    }
  };
}
