import Database from "better-sqlite3";
import {
  initSchema,
  insertEventBatch,
  setDb,
  getDb,
} from "../src/indexer/db.js";
import { toEventTimestamp } from "../src/indexer/poller.js";

let testDb: Database.Database;

beforeAll(() => {
  testDb = new Database(":memory:");
  setDb(testDb);
  initSchema();
});

afterAll(() => {
  testDb.close();
});

beforeEach(() => {
  testDb.exec("DELETE FROM events");
});

describe("toEventTimestamp() (#708)", () => {
  it("parses a valid ISO ledgerClosedAt to epoch seconds", () => {
    expect(toEventTimestamp("2024-01-01T00:00:00.000Z")).toBe(1704067200);
  });

  it("returns null when ledgerClosedAt is missing", () => {
    expect(toEventTimestamp(undefined)).toBeNull();
    expect(toEventTimestamp(null)).toBeNull();
    expect(toEventTimestamp("")).toBeNull();
  });

  it("returns null (not NaN) for an invalid date string", () => {
    const result = toEventTimestamp("not-a-date");
    expect(result).toBeNull();
    expect(Number.isNaN(result)).toBe(false);
  });
});

describe("insertEventBatch() with null timestamps (#708)", () => {
  it("stores NULL instead of wall-clock time", () => {
    insertEventBatch(
      [
        {
          contractId: "C-NULLTS",
          eventType: "funded",
          ledgerSequence: 42,
          timestamp: null,
          dataJson: JSON.stringify({ client: "GCLIENT" }),
        },
      ],
      42,
    );

    const row = getDb()
      .prepare("SELECT timestamp FROM events WHERE contract_id = ?")
      .get("C-NULLTS") as { timestamp: number | null };
    expect(row.timestamp).toBeNull();
  });
});
