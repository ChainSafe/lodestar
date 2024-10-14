import {describe, it, expect, beforeEach, afterEach, vi, MockInstance} from "vitest";
import {config} from "@lodestar/config/default";
import {TimeoutError} from "@lodestar/utils";
import {Eth1DepositDataTracker} from "../../../src/eth1/eth1DepositDataTracker.js";
import {Eth1Provider} from "../../../src/eth1/provider/eth1Provider.js";
import {testLogger} from "../../utils/logger.js";
import {defaultEth1Options} from "../../../src/eth1/options.js";
import {BeaconDb} from "../../../src/db/beacon.js";
import {getMockedBeaconDb} from "../../mocks/mockedBeaconDb.js";

describe("Eth1DepositDataTracker", () => {
  const controller = new AbortController();

  const logger = testLogger();
  const opts = {...defaultEth1Options, enabled: false};
  const signal = controller.signal;
  const eth1Provider = new Eth1Provider(config, opts, signal, null);
  let db: BeaconDb;
  let eth1DepositDataTracker: Eth1DepositDataTracker;
  let getBlocksByNumberStub: MockInstance;
  let getDepositEventsStub: MockInstance;

  beforeEach(() => {
    db = getMockedBeaconDb();
    eth1DepositDataTracker = new Eth1DepositDataTracker(
      opts,
      {config, db, logger, signal, metrics: null},
      eth1Provider
    );
    vi.spyOn(Eth1DepositDataTracker.prototype as any, "getLastProcessedDepositBlockNumber").mockResolvedValue(0);
    vi.spyOn(eth1DepositDataTracker["eth1DataCache"], "getHighestCachedBlockNumber").mockResolvedValue(0);
    vi.spyOn(eth1DepositDataTracker["eth1DataCache"], "add").mockResolvedValue(void 0);

    vi.spyOn(eth1DepositDataTracker["depositsCache"], "getEth1DataForBlocks").mockResolvedValue([]);
    vi.spyOn(eth1DepositDataTracker["depositsCache"], "add").mockResolvedValue(void 0);
    vi.spyOn(eth1DepositDataTracker["depositsCache"], "getLowestDepositEventBlockNumber").mockResolvedValue(0);

    getBlocksByNumberStub = vi.spyOn(eth1Provider, "getBlocksByNumber");
    getDepositEventsStub = vi.spyOn(eth1Provider, "getDepositEvents");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Should dynamically adjust blocks batch size", async () => {
    let expectedSize = 1000;
    expect(eth1DepositDataTracker["eth1GetBlocksBatchSizeDynamic"]).toBe(expectedSize);

    // If there are timeerrors or parse errors then batch size should reduce
    getBlocksByNumberStub.mockRejectedValue(new TimeoutError("timeout error"));
    for (let i = 0; i < 10; i++) {
      expectedSize = Math.max(Math.floor(expectedSize / 2), 10);
      await eth1DepositDataTracker["updateBlockCache"](3000).catch((_e) => void 0);
      expect(eth1DepositDataTracker["eth1GetBlocksBatchSizeDynamic"]).toBe(expectedSize);
    }
    expect(expectedSize).toBe(10);

    getBlocksByNumberStub.mockResolvedValue([]);
    // Should take a whole longer to get back to the orignal batch size
    for (let i = 0; i < 100; i++) {
      expectedSize = Math.min(expectedSize + 10, 1000);
      await eth1DepositDataTracker["updateBlockCache"](3000);
      expect(eth1DepositDataTracker["eth1GetBlocksBatchSizeDynamic"]).toBe(expectedSize);
    }
    expect(expectedSize).toBe(1000);
  });

  it("Should dynamically adjust logs batch size", async () => {
    let expectedSize = 1000;
    expect(eth1DepositDataTracker["eth1GetLogsBatchSizeDynamic"]).toBe(expectedSize);

    // If there are timeerrors or parse errors then batch size should reduce
    getDepositEventsStub.mockRejectedValue(new TimeoutError("timeout error"));
    for (let i = 0; i < 10; i++) {
      expectedSize = Math.max(Math.floor(expectedSize / 2), 10);
      await eth1DepositDataTracker["updateDepositCache"](3000).catch((_e) => void 0);
      expect(eth1DepositDataTracker["eth1GetLogsBatchSizeDynamic"]).toBe(expectedSize);
    }
    expect(expectedSize).toBe(10);

    getDepositEventsStub.mockResolvedValue([]);
    // Should take a whole longer to get back to the orignal batch size
    for (let i = 0; i < 100; i++) {
      expectedSize = Math.min(expectedSize + 10, 1000);
      await eth1DepositDataTracker["updateDepositCache"](3000);
      expect(eth1DepositDataTracker["eth1GetLogsBatchSizeDynamic"]).toBe(expectedSize);
    }
    expect(expectedSize).toBe(1000);
  });
});
