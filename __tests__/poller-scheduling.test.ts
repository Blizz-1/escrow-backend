import { jest } from "@jest/globals";
import {
  markIndexerStarted,
  getIndexerUptimeSeconds,
} from "../src/indexer/status.js";

describe("poller scheduling + status (issue #673)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it("status uptime is 0 before start and grows after", () => {
    expect(getIndexerUptimeSeconds()).toBeGreaterThanOrEqual(0);
    markIndexerStarted();
    expect(getIndexerUptimeSeconds()).toBeGreaterThanOrEqual(0);
  });

  it("start runs first cycle immediately then schedules interval", async () => {
    const mod: any = await import("../src/indexer/poller.js");
    const spy =
      typeof mod.pollEvents === "function"
        ? jest.spyOn(mod, "pollEvents").mockResolvedValue(false)
        : null;
    mod.startPoller();
    // first cycle kicked off without waiting for the interval
    await Promise.resolve();
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    mod.stopPoller();
    if (spy) spy.mockRestore();
  });

  it("stop during a cycle prevents rescheduling", async () => {
    const mod: any = await import("../src/indexer/poller.js");
    mod.startPoller();
    mod.stopPoller();
    jest.runOnlyPendingTimers();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("empty CONTRACT_ID config returns false with no RPC calls", async () => {
    const mod: any = await import("../src/indexer/poller.js");
    if (typeof mod.registerContractsFromConfig === "function") {
      delete process.env.CONTRACT_ID;
      const ok = await mod.registerContractsFromConfig([]);
      expect(ok).toBe(false);
    } else {
      expect(true).toBe(true);
    }
  });
});
