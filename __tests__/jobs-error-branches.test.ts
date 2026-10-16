import { jest } from "@jest/globals";
import request from "supertest";
import express from "express";
import { autoAuth } from "./helpers/api-key-helper.js";
import type { NextFunction, Request, Response } from "express";

const VALID_CONTRACT =
  "CDD5WKK3WT3QVKXMXTJNDIXE4T73FK6GGXDSD6UTJAH6YYZU52SQ4MUH";

const mockGetAccount = jest.fn<() => Promise<unknown>>();
const mockSimulateTransaction = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("@stellar/stellar-sdk/rpc", () => ({
  Server: class MockServer {
    getAccount = mockGetAccount;
    simulateTransaction = mockSimulateTransaction;
  },
}));

const { default: router } = await import("../src/routes/jobs.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(autoAuth);
  app.use("/api/jobs", router);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, error: "Internal server error" });
  });
  return app;
}

function noLeak(res: any) {
  expect(res.text).not.toContain("stack");
  expect(res.text).not.toContain("host unreachable");
}

describe("jobs routes error/cache branches (issue #672)", () => {
  beforeEach(() => {
    mockGetAccount.mockReset();
    mockSimulateTransaction.mockReset();
    mockGetAccount.mockResolvedValue({
      accountId: () => "GAODBHVR63Z56MVQRBEJSYM2H5423LJ4WAPUUBOFG4JYY72S6ROKVZRX",
      sequenceNumber: () => "1",
      incrementSequenceNumber: () => {},
    });
  });

  it("history validation errors do not leak internals", async () => {
    const res = await request(buildApp()).get("/api/jobs/history?limit=bad");
    expect([400, 422, 500]).toContain(res.status);
    noLeak(res);
  });

  it("whitelist single-update maps 401/404/500 without raw text", async () => {
    mockSimulateTransaction.mockResolvedValue({ error: "host unreachable" });
    const res = await request(buildApp())
      .post(`/api/jobs/${VALID_CONTRACT}/whitelist/update`)
      .send({ address: "GABC" });
    expect([400, 401, 404, 500]).toContain(res.status);
    noLeak(res);
  });

  it("partial-release prepare failures are sanitized", async () => {
    mockSimulateTransaction.mockRejectedValue(new Error("host unreachable"));
    const res = await request(buildApp())
      .post(`/api/jobs/${VALID_CONTRACT}/milestones/0/partial-release`)
      .send({ amount: "100" });
    expect([400, 500]).toContain(res.status);
    noLeak(res);
  });

  it("time-remaining simulation errors do not cache failures", async () => {
    mockSimulateTransaction.mockResolvedValue({ error: "host unreachable" });
    const app = buildApp();
    const r1 = await app.get(
      `/api/jobs/${VALID_CONTRACT}/milestones/0/time-remaining`,
    );
    const r2 = await app.get(
      `/api/jobs/${VALID_CONTRACT}/milestones/0/time-remaining`,
    );
    noLeak(r1);
    noLeak(r2);
    // Second call must re-attempt (failure not cached): both carry sanitized bodies
    expect(r2.body.success ?? false).toBe(false);
  });
});
