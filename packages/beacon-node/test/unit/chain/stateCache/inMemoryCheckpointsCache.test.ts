import {describe, beforeAll, it, expect, beforeEach} from "vitest";
import {CachedBeaconStateAllForks, computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {phase0} from "@lodestar/types";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {
  CheckpointHex,
  InMemoryCheckpointStateCache,
  toCheckpointHex,
} from "../../../../src/chain/stateCache/inMemoryCheckpointsCache.js";
import {generateCachedState} from "../../../utils/state.js";

describe("InMemoryCheckpointStateCache", () => {
  let root0a: Buffer, root0b: Buffer, root1: Buffer, root2: Buffer;
  let cp0a: phase0.Checkpoint, cp0b: phase0.Checkpoint, cp1: phase0.Checkpoint, cp2: phase0.Checkpoint;
  let cp0aHex: CheckpointHex, cp0bHex: CheckpointHex, cp1Hex: CheckpointHex, cp2Hex: CheckpointHex;
  let states: Record<"cp0a" | "cp0b" | "cp1" | "cp2", CachedBeaconStateAllForks>;

  let cache: InMemoryCheckpointStateCache;

  const startSlotEpoch20 = computeStartSlotAtEpoch(20);
  const startSlotEpoch21 = computeStartSlotAtEpoch(21);
  const startSlotEpoch22 = computeStartSlotAtEpoch(22);

  beforeAll(() => {
    root0a = Buffer.alloc(32);
    root0b = Buffer.alloc(32, 1);
    root1 = Buffer.alloc(32, 2);
    root2 = Buffer.alloc(32, 3);
    root0b[31] = 1;
    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^           ^           ^
    //                       ||           |           |
    //                       |0b--------root1--------root2
    //                       |
    //                       0a
    // root0a is of the last slot of epoch 19
    cp0a = {epoch: 20, root: root0a};
    // root0b is of the first slot of epoch 20
    cp0b = {epoch: 20, root: root0b};
    cp1 = {epoch: 21, root: root1};
    cp2 = {epoch: 22, root: root2};
    [cp0aHex, cp0bHex, cp1Hex, cp2Hex] = [cp0a, cp0b, cp1, cp2].map((cp) => toCheckpointHex(cp));
    const allStates = [cp0a, cp0b, cp1, cp2]
      .map((cp) => generateCachedState({slot: cp.epoch * SLOTS_PER_EPOCH}))
      .map((state, i) => {
        const stateEpoch = computeEpochAtSlot(state.slot);
        if (stateEpoch === 20 && i === 0) {
          // cp0a
          state.blockRoots.set((startSlotEpoch20 - 1) % SLOTS_PER_HISTORICAL_ROOT, root0a);
          state.blockRoots.set(startSlotEpoch20 % SLOTS_PER_HISTORICAL_ROOT, root0a);
          return state;
        }

        // other states based on cp0b
        state.blockRoots.set((startSlotEpoch20 - 1) % SLOTS_PER_HISTORICAL_ROOT, root0a);
        state.blockRoots.set(startSlotEpoch20 % SLOTS_PER_HISTORICAL_ROOT, root0b);

        if (stateEpoch >= 21) {
          state.blockRoots.set(startSlotEpoch21 % SLOTS_PER_HISTORICAL_ROOT, root1);
        }
        if (stateEpoch >= 22) {
          state.blockRoots.set(startSlotEpoch22 % SLOTS_PER_HISTORICAL_ROOT, root2);
        }
        return state;
      });

    states = {
      // Previous Root Checkpoint State of epoch 20
      cp0a: allStates[0],
      // Current Root Checkpoint State of epoch 20
      cp0b: allStates[1],
      // Current Root Checkpoint State of epoch 21
      cp1: allStates[2],
      // Current Root Checkpoint State of epoch 22
      cp2: allStates[3],
    };

    for (const state of allStates) {
      state.hashTreeRoot();
    }
  });

  beforeEach(() => {
    cache = new InMemoryCheckpointStateCache({}, {maxEpochs: 0});
    cache.add(cp0a, states["cp0a"]);
    cache.add(cp0b, states["cp0b"]);
    cache.add(cp1, states["cp1"]);
  });

  it("getLatest", () => {
    // cp0
    expect(cache.getLatest(cp0aHex.rootHex, cp0a.epoch)?.hashTreeRoot()).toEqual(states["cp0a"].hashTreeRoot());
    expect(cache.getLatest(cp0aHex.rootHex, cp0a.epoch + 1)?.hashTreeRoot()).toEqual(states["cp0a"].hashTreeRoot());
    expect(cache.getLatest(cp0aHex.rootHex, cp0a.epoch - 1)?.hashTreeRoot()).toBeUndefined();

    // cp1
    expect(cache.getLatest(cp1Hex.rootHex, cp1.epoch)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
    expect(cache.getLatest(cp1Hex.rootHex, cp1.epoch + 1)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
    expect(cache.getLatest(cp1Hex.rootHex, cp1.epoch - 1)?.hashTreeRoot()).toBeUndefined();

    // cp2
    expect(cache.getLatest(cp2Hex.rootHex, cp2.epoch)?.hashTreeRoot()).toBeUndefined();
  });

  it("getStateOrBytes", async () => {
    expect(((await cache.getStateOrBytes(cp0aHex)) as CachedBeaconStateAllForks).hashTreeRoot()).toEqual(
      states["cp0a"].hashTreeRoot()
    );
    expect(((await cache.getStateOrBytes(cp0bHex)) as CachedBeaconStateAllForks).hashTreeRoot()).toEqual(
      states["cp0b"].hashTreeRoot()
    );
    expect(((await cache.getStateOrBytes(cp1Hex)) as CachedBeaconStateAllForks).hashTreeRoot()).toEqual(
      states["cp1"].hashTreeRoot()
    );
    expect(await cache.getStateOrBytes(cp2Hex)).toBeNull();
  });

  it("get", () => {
    expect((cache.get(cp0aHex) as CachedBeaconStateAllForks).hashTreeRoot()).toEqual(states["cp0a"].hashTreeRoot());
    expect((cache.get(cp0bHex) as CachedBeaconStateAllForks).hashTreeRoot()).toEqual(states["cp0b"].hashTreeRoot());
    expect((cache.get(cp1Hex) as CachedBeaconStateAllForks).hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
    expect(cache.get(cp2Hex) as CachedBeaconStateAllForks).toBeNull();
  });

  it("pruneFinalized", () => {
    cache.pruneFinalized(21);
    expect(cache.get(cp0aHex) as CachedBeaconStateAllForks).toBeNull();
    expect(cache.get(cp0bHex) as CachedBeaconStateAllForks).toBeNull();
    expect((cache.get(cp1Hex) as CachedBeaconStateAllForks).hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
  });

  it("prune", () => {
    cache.add(cp2, states["cp2"]);
    const finalizedEpoch = 21;
    const justifiedEpoch = 22;
    cache.prune(finalizedEpoch, justifiedEpoch);
    expect(cache.get(cp0aHex) as CachedBeaconStateAllForks).toBeNull();
    expect(cache.get(cp0bHex) as CachedBeaconStateAllForks).toBeNull();
    expect((cache.get(cp1Hex) as CachedBeaconStateAllForks).hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
    expect((cache.get(cp2Hex) as CachedBeaconStateAllForks).hashTreeRoot()).toEqual(states["cp2"].hashTreeRoot());
  });
});
