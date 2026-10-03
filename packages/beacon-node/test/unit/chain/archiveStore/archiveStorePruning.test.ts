import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconDb} from "../../../../src/db/index.js";
import {startIsolatedTmpBeaconDb} from "../../../utils/db.js";

describe("engine / state pruning progress", () => {
  const previousSlot = computeStartSlotAtEpoch(90);
  const nextSlot = computeStartSlotAtEpoch(100);
  let db: BeaconDb;
  let closeDb: () => Promise<void>;
  let prune: (epoch: number) => Promise<number>;

  beforeEach(async () => {
    ({db, close: closeDb} = await startIsolatedTmpBeaconDb(config, "lodestar-archive-store-pruning-"));
    const engine = Object.assign(Object.create(BeaconEngine.prototype) as BeaconEngine, {
      config,
      db,
      logger: testLogger(),
      metrics: null,
    });
    prune = (epoch) => engine.pruneHistory(epoch, epoch);
    await db.stateArchive.putBinary(0, new Uint8Array([0]));
    await db.stateArchive.putBinary(previousSlot, new Uint8Array([1]));
    await prune(98);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeDb();
  });

  it("reuses the startup cutoff and advances it after pruning a new state range", async () => {
    const keys = vi.spyOn(db.stateArchive, "keys");
    await prune(99);
    expect(keys.mock.calls.filter(([opts]) => opts?.gte !== undefined)).toEqual([]);
    await db.stateArchive.putBinary(nextSlot, new Uint8Array([2]));
    await prune(102);
    expect(await db.stateArchive.keys()).toEqual([nextSlot]);
    await prune(103);
    expect(keys.mock.calls.filter(([opts]) => opts?.gte !== undefined)).toEqual([[{gte: previousSlot, lt: nextSlot}]]);
  });

  it("retries the same state range when deletion fails", async () => {
    await db.stateArchive.putBinary(nextSlot, new Uint8Array([2]));
    const keys = vi.spyOn(db.stateArchive, "keys");
    const error = new Error("State deletion failed");
    vi.spyOn(db.stateArchive, "batchDelete").mockRejectedValueOnce(error);
    await expect(prune(102)).rejects.toBe(error);
    expect(await db.stateArchive.keys()).toEqual([previousSlot, nextSlot]);
    await prune(102);
    expect(keys.mock.calls.filter(([opts]) => opts?.gte !== undefined)).toEqual([
      [{gte: previousSlot, lt: nextSlot}],
      [{gte: previousSlot, lt: nextSlot}],
    ]);
    expect(await db.stateArchive.keys()).toEqual([nextSlot]);
  });
});
