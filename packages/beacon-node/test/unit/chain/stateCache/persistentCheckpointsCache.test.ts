import {describe, it, expect, beforeAll, beforeEach} from "vitest";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {CachedBeaconStateAllForks, computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex, phase0} from "@lodestar/types";
import {mapValues, toHexString} from "@lodestar/utils";
import {
  PersistentCheckpointStateCache,
  toCheckpointHex,
} from "../../../../src/chain/stateCache/persistentCheckpointsCache.js";
import {generateCachedState} from "../../../utils/state.js";
import {ShufflingCache} from "../../../../src/chain/shufflingCache.js";
import {testLogger} from "../../../utils/logger.js";
import {checkpointToPersistentKey, getTestPersistentApi} from "../../../utils/chain/stateCache/persistent.js";
import {CheckpointHex} from "../../../../src/chain/stateCache/types.js";

describe("PersistentCheckpointStateCache", function () {
  let root0a: Buffer, root0b: Buffer, root1: Buffer, root2: Buffer;
  let cp0a: phase0.Checkpoint, cp0b: phase0.Checkpoint, cp1: phase0.Checkpoint, cp2: phase0.Checkpoint;
  let cp0aHex: CheckpointHex, cp0bHex: CheckpointHex, cp1Hex: CheckpointHex, cp2Hex: CheckpointHex;
  let persistent0bKey: RootHex;
  const startSlotEpoch20 = computeStartSlotAtEpoch(20);
  const startSlotEpoch21 = computeStartSlotAtEpoch(21);
  const startSlotEpoch22 = computeStartSlotAtEpoch(22);
  let cache: PersistentCheckpointStateCache;
  let fileApisBuffer: Map<string, Uint8Array>;
  let states: Record<"cp0a" | "cp0b" | "cp1" | "cp2", CachedBeaconStateAllForks>;
  let stateBytes: Record<"cp0a" | "cp0b" | "cp1" | "cp2", Uint8Array>;

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
    persistent0bKey = toHexString(checkpointToPersistentKey(cp0b));
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
    stateBytes = mapValues(states, (state) => state.serialize());
  });

  beforeEach(() => {
    fileApisBuffer = new Map();
    const persistentApis = getTestPersistentApi(fileApisBuffer);
    cache = new PersistentCheckpointStateCache(
      {persistentApis, logger: testLogger(), shufflingCache: new ShufflingCache()},
      {maxEpochsInMemory: 2}
    );
    cache.add(cp0a, states["cp0a"]);
    cache.add(cp0b, states["cp0b"]);
    cache.add(cp1, states["cp1"]);
  });

  it("getLatest", () => {
    // cp0
    expect(cache.getLatest(cp0aHex.rootHex, cp0a.epoch)?.hashTreeRoot()).toEqual(states["cp0a"].hashTreeRoot());
    expect(cache.getLatest(cp0aHex.rootHex, cp0a.epoch + 1)?.hashTreeRoot()).toEqual(states["cp0a"].hashTreeRoot());
    expect(cache.getLatest(cp0aHex.rootHex, cp0a.epoch - 1)?.hashTreeRoot()).to.be.undefined;

    // cp1
    expect(cache.getLatest(cp1Hex.rootHex, cp1.epoch)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
    expect(cache.getLatest(cp1Hex.rootHex, cp1.epoch + 1)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
    expect(cache.getLatest(cp1Hex.rootHex, cp1.epoch - 1)?.hashTreeRoot()).to.be.undefined;

    // cp2
    expect(cache.getLatest(cp2Hex.rootHex, cp2.epoch)?.hashTreeRoot()).to.be.undefined;
  });

  it("getOrReloadLatest", async () => {
    cache.add(cp2, states["cp2"]);
    expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);

    // cp0b is persisted
    expect(fileApisBuffer.size).toEqual(1);
    expect(Array.from(fileApisBuffer.keys())).toEqual([persistent0bKey]);

    // getLatest() does not reload from disk
    expect(cache.getLatest(cp0aHex.rootHex, cp0a.epoch)).to.be.null;
    expect(cache.getLatest(cp0bHex.rootHex, cp0b.epoch)).to.be.null;

    // cp0a has the root from previous epoch so we only prune it from db
    expect(await cache.getOrReloadLatest(cp0aHex.rootHex, cp0a.epoch)).to.be.null;
    // but getOrReloadLatest() does for cp0b
    expect((await cache.getOrReloadLatest(cp0bHex.rootHex, cp0b.epoch))?.serialize()).toEqual(stateBytes["cp0b"]);
    expect((await cache.getOrReloadLatest(cp0bHex.rootHex, cp0b.epoch + 1))?.serialize()).toEqual(stateBytes["cp0b"]);
    expect((await cache.getOrReloadLatest(cp0bHex.rootHex, cp0b.epoch - 1))?.serialize()).to.be.undefined;
  });

  it("pruneFinalized and getStateOrBytes", async function () {
    cache.add(cp2, states["cp2"]);
    expect(await cache.getStateOrBytes(cp0bHex)).toEqual(states["cp0b"]);
    expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
    // cp0 is persisted
    expect(fileApisBuffer.size).toEqual(1);
    expect(Array.from(fileApisBuffer.keys())).toEqual([persistent0bKey]);
    expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
    // cp1 is in memory
    expect(cache.get(cp1Hex)).to.be.not.null;
    // cp2 is in memory
    expect(cache.get(cp2Hex)).to.be.not.null;
    // finalize epoch cp2
    cache.pruneFinalized(cp2.epoch);
    expect(fileApisBuffer.size).toEqual(0);
    expect(cache.get(cp1Hex)).to.be.null;
    expect(cache.get(cp2Hex)).to.be.not.null;
    expect(await cache.getStateOrBytes(cp0bHex)).to.be.null;
  });

  describe("findSeedStateToReload", () => {
    beforeEach(() => {
      fileApisBuffer = new Map();
      const persistentApis = getTestPersistentApi(fileApisBuffer);
      cache = new PersistentCheckpointStateCache(
        {persistentApis, logger: testLogger(), shufflingCache: new ShufflingCache()},
        {maxEpochsInMemory: 2}
      );
      cache.add(cp0a, states["cp0a"]);
      cache.add(cp0b, states["cp0b"]);
      cache.add(cp1, states["cp1"]);
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^           ^           ^
    //                       ||           |           |
    //                       |0b--------root1--------root2
    //                       |
    //                       0a
    it("single state at lowest memory epoch", async function () {
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
      expect(cache.findSeedStateToReload(cp0aHex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      expect(cache.findSeedStateToReload(cp0bHex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^           ^           ^        ^
    //                       ||           |           |        |
    //                       |0b--------root1--------root2     |
    //                       |                                 |
    //                       0a------------------------------root3
    //                                    ^           ^
    //                           cp1a={0a, 21}       {0a, 22}=cp2a
    it("multiple states at lowest memory epoch", async function () {
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);

      const cp1a = {epoch: 21, root: root0a};
      const cp1aState = states["cp0a"].clone();
      cp1aState.slot = 21 * SLOTS_PER_EPOCH;
      cp1aState.blockRoots.set(startSlotEpoch21 % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cp1aState.commit();
      cache.add(cp1a, cp1aState);

      const cp2a = {epoch: 22, root: root0a};
      const cp2aState = cp1aState.clone();
      cp2aState.slot = 22 * SLOTS_PER_EPOCH;
      cp2aState.blockRoots.set(startSlotEpoch22 % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cp2aState.commit();
      cache.add(cp2a, cp2aState);

      const root3 = Buffer.alloc(32, 100);
      const state3 = cp2aState.clone();
      state3.slot = 22 * SLOTS_PER_EPOCH + 3;
      state3.commit();
      await cache.processState(toHexString(root3), state3);

      // state of {0a, 21} is choosen because it was built from cp0a
      expect(cache.findSeedStateToReload(cp0aHex)?.hashTreeRoot()).toEqual(cp1aState.hashTreeRoot());
      // cp1 is choosen for 0b because it was built from cp0b
      expect(cache.findSeedStateToReload(cp0bHex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      const randomRoot = Buffer.alloc(32, 101);
      // for other random root it'll pick the first state of epoch 21 which is states["cp1"]
      expect(cache.findSeedStateToReload({epoch: 20, rootHex: toHexString(randomRoot)})?.hashTreeRoot()).toEqual(
        states["cp1"].hashTreeRoot()
      );
    });
  });

  describe("processState, maxEpochsInMemory = 2", () => {
    beforeEach(() => {
      fileApisBuffer = new Map();
      const persistentApis = getTestPersistentApi(fileApisBuffer);
      cache = new PersistentCheckpointStateCache(
        {persistentApis, logger: testLogger(), shufflingCache: new ShufflingCache()},
        {maxEpochsInMemory: 2}
      );
      cache.add(cp0a, states["cp0a"]);
      cache.add(cp0b, states["cp0b"]);
      cache.add(cp1, states["cp1"]);
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^           ^           ^         ^
    //                       ||           |           |         |
    //                       |0b--------root1--------root2-----root3
    //                       |
    //                       0a
    it("no reorg", async function () {
      expect(fileApisBuffer.size).toEqual(0);
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
      expect(cache.get(cp2Hex)?.hashTreeRoot()).toEqual(states["cp2"].hashTreeRoot());
      expect(fileApisBuffer.size).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      const blockStateRoot3 = states["cp2"].clone();
      blockStateRoot3.slot = 22 * SLOTS_PER_EPOCH + 3;
      const root3 = Buffer.alloc(32, 100);
      // process state of root3
      await cache.processState(toHexString(root3), blockStateRoot3);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      // epoch 22 has 1 checkpoint state
      expect(cache.get(cp2Hex)).to.be.not.null;
      // epoch 21 has 1 checkpoint state
      expect(cache.get(cp1Hex)).to.be.not.null;
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0bHex)).to.be.null;
      // but cp0bHex is persisted
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      // while cp0aHex is not
      expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^           ^           ^    ^     ^
    //                       ||           |           |    |     |
    //                       |0b--------root1--------root2-root3 |
    //                       |                        |
    //                       0a                       |---------root4
    it("reorg in same epoch", async function () {
      // mostly the same to the above test
      expect(fileApisBuffer.size).toEqual(0);
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
      expect(cache.get(cp2Hex)?.hashTreeRoot()).toEqual(states["cp2"].hashTreeRoot());
      expect(fileApisBuffer.size).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      const blockStateRoot3 = states["cp2"].clone();
      blockStateRoot3.slot = 22 * SLOTS_PER_EPOCH + 3;
      const root3 = Buffer.alloc(32, 100);
      // process state of root3
      await cache.processState(toHexString(root3), blockStateRoot3);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      const blockStateRoot4 = states["cp2"].clone();
      blockStateRoot4.slot = 22 * SLOTS_PER_EPOCH + 4;
      const root4 = Buffer.alloc(32, 101);
      // process state of root4
      await cache.processState(toHexString(root4), blockStateRoot4);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      // epoch 22 has 1 checkpoint state
      expect(cache.get(cp2Hex)).to.be.not.null;
      // epoch 21 has 1 checkpoint state
      expect(cache.get(cp1Hex)).to.be.not.null;
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0bHex)).to.be.null;
      // but cp0bHex is persisted
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      // while cp0aHex is not
      expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                        ^           ^        ^  ^     ^
    //                        |           |        |  |     |
    //                        0b---------root1-----|-root2  |
    //                                             |        |
    //                                             |------root3
    //                                            1a  ^
    //                                                |
    //                                               {1a, 22}=cp2a
    it("reorg 1 epoch", async function () {
      // process root2 state
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      // regen generates cp2a
      const root1a = Buffer.alloc(32, 100);
      const cp2a = {epoch: 22, root: root1a};
      const cp2aState = states["cp1"].clone();
      cp2aState.slot = 22 * SLOTS_PER_EPOCH;
      // assuming reorg block is at slot 5 of epoch 21
      cp2aState.blockRoots.set((startSlotEpoch21 + 5) % SLOTS_PER_HISTORICAL_ROOT, root1a);
      cp2aState.blockRoots.set(startSlotEpoch22 % SLOTS_PER_HISTORICAL_ROOT, root1a);
      cache.add(cp2a, cp2aState);

      // block state of root3 in epoch 22 is built on cp2a
      const blockStateRoot3 = cp2aState.clone();
      blockStateRoot3.slot = 22 * SLOTS_PER_EPOCH + 3;

      const root3 = Buffer.alloc(32, 101);
      // process state of root3
      await cache.processState(toHexString(root3), blockStateRoot3);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      // epoch 22 has 2 checkpoint states
      expect(cache.get(cp2Hex)).to.be.not.null;
      expect(cache.get(toCheckpointHex(cp2a))).to.be.not.null;
      // epoch 21 has 1 checkpoint state
      expect(cache.get(cp1Hex)).to.be.not.null;
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0aHex)).to.be.null;
      expect(cache.get(cp0bHex)).to.be.null;
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                        ^         ^ ^           ^     ^
    //                        |         | |           |     |
    //                        0b--------|root1-------root2  |
    //                                  |                   |
    //                                  |-----------------root3
    //                                 0a ^           ^
    //                                    |           |
    //                            cp1a={0a, 21}     {0a, 22}=cp2a
    it("reorg 2 epochs", async function () {
      // process root2 state
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      // reload cp0b from disk
      expect((await cache.getOrReload(toCheckpointHex(cp0b)))?.serialize()).toStrictEqual(stateBytes["cp0b"]);

      // regen generates cp1a
      const root0a = Buffer.alloc(32, 100);
      const cp1a = {epoch: 21, root: root0a};
      const cp1aState = states["cp0b"].clone();
      cp1aState.slot = 21 * SLOTS_PER_EPOCH;
      // assuming reorg block is at slot 5 of epoch 20
      cp1aState.blockRoots.set((startSlotEpoch20 + 5) % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cache.add(cp1a, cp1aState);

      // regen generates cp2a
      const cp2a = {epoch: 22, root: root0a};
      const cp2aState = cp1aState.clone();
      cp2aState.slot = 22 * SLOTS_PER_EPOCH;
      cp2aState.blockRoots.set(startSlotEpoch22 % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cache.add(cp2a, cp2aState);

      // block state of root3 in epoch 22 is built on cp2a
      const blockStateRoot3 = cp2aState.clone();
      blockStateRoot3.slot = 22 * SLOTS_PER_EPOCH + 3;

      const root3 = Buffer.alloc(32, 101);
      // process state of root3
      await cache.processState(toHexString(root3), blockStateRoot3);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      // epoch 21 and 22 have 2 checkpoint states
      expect(cache.get(cp1Hex)).to.be.not.null;
      expect(cache.get(toCheckpointHex(cp1a))).to.be.not.null;
      expect(cache.get(cp2Hex)).to.be.not.null;
      expect(cache.get(toCheckpointHex(cp2a))).to.be.not.null;
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0aHex)).to.be.null;
      expect(cache.get(cp0bHex)).to.be.null;
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^           ^           ^     ^
    //                       ||           |           |     |
    //                       |0b--------root1--------root2  |
    //                       |/                             |
    //                       0a---------------------------root3
    //                                    ^           ^
    //                                    |           |
    //                            cp1a={0a, 21}     {0a, 22}=cp2a
    it("reorg 3 epochs, persist cp 0a", async function () {
      // process root2 state
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      // cp0a was pruned from memory and not in disc
      expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;

      // regen needs to regen cp0a
      cache.add(cp0a, states["cp0a"]);

      // regen generates cp1a
      const cp1a = {epoch: 21, root: root0a};
      const cp1aState = generateCachedState({slot: 21 * SLOTS_PER_EPOCH});
      cp1aState.blockRoots.set((startSlotEpoch20 - 1) % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cp1aState.blockRoots.set(startSlotEpoch20 % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cache.add(cp1a, cp1aState);

      // regen generates cp2a
      const cp2a = {epoch: 22, root: root0a};
      const cp2aState = cp1aState.clone();
      cp2aState.slot = 22 * SLOTS_PER_EPOCH;
      cp2aState.blockRoots.set(startSlotEpoch21 % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cache.add(cp2a, cp2aState);

      // block state of root3 in epoch 22 is built on cp2a
      const blockStateRoot3 = cp2aState.clone();
      blockStateRoot3.slot = 22 * SLOTS_PER_EPOCH + 3;
      blockStateRoot3.blockRoots.set(startSlotEpoch22 % SLOTS_PER_HISTORICAL_ROOT, root0a);

      // regen populates cache when producing blockStateRoot3

      const root3 = Buffer.alloc(32, 100);
      // process state of root3
      expect(await cache.processState(toHexString(root3), blockStateRoot3)).toEqual(1);
      await assertPersistedCheckpointState([cp0b, cp0a], [stateBytes["cp0b"], stateBytes["cp0a"]]);
      // epoch 21 and 22 have 2 checkpoint states
      expect(cache.get(cp1Hex)).to.be.not.null;
      expect(cache.get(toCheckpointHex(cp1a))).to.be.not.null;
      expect(cache.get(cp2Hex)).to.be.not.null;
      expect(cache.get(toCheckpointHex(cp2a))).to.be.not.null;
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0aHex)).to.be.null;
      expect(cache.get(cp0bHex)).to.be.null;
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^           ^           ^     ^
    //                       ||           |           |     |
    //                       |0b--------root1--------root2  |
    //                       ||                             |
    //                       ||---------------------------root3
    //                      0a            ^           ^
    //                                    |           |
    //                            cp1b={0b, 21}     {0b, 22}=cp2b
    it("reorg 3 epochs, prune but no persist", async function () {
      // process root2 state
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      // cp0a was pruned from memory and not in disc
      expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;

      // regen needs to reload cp0b
      cache.add(cp0b, states["cp0b"]);
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(states["cp0b"]);

      // regen generates cp1b
      const cp1b = {epoch: 21, root: root0b};
      const cp1bState = states["cp0b"].clone();
      cp1bState.slot = 21 * SLOTS_PER_EPOCH;
      cp1bState.blockRoots.set(startSlotEpoch21 % SLOTS_PER_HISTORICAL_ROOT, root0b);
      cache.add(cp1b, cp1bState);

      // regen generates cp2b
      const cp2b = {epoch: 22, root: root0b};
      const cp2bState = cp1bState.clone();
      cp2bState.slot = 22 * SLOTS_PER_EPOCH;
      cp2bState.blockRoots.set(startSlotEpoch22 % SLOTS_PER_HISTORICAL_ROOT, root0b);
      cache.add(cp2b, cp2bState);

      // block state of root3 in epoch 22 is built on cp2a
      const blockStateRoot3 = cp2bState.clone();
      blockStateRoot3.slot = 22 * SLOTS_PER_EPOCH + 3;
      const root3 = Buffer.alloc(32, 100);
      // process state of root3, nothing is persisted
      expect(await cache.processState(toHexString(root3), blockStateRoot3)).toEqual(0);
      // but state of cp0b is pruned from memory
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      // epoch 21 and 22 have 2 checkpoint states
      expect(cache.get(cp1Hex)).to.be.not.null;
      expect(cache.get(toCheckpointHex(cp1b))).to.be.not.null;
      expect(cache.get(cp2Hex)).to.be.not.null;
      expect(cache.get(toCheckpointHex(cp2b))).to.be.not.null;
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0aHex)).to.be.null;
      expect(cache.get(cp0bHex)).to.be.null;
    });
  });

  describe("processState, maxEpochsInMemory = 1", () => {
    beforeEach(() => {
      fileApisBuffer = new Map();
      const persistentApis = getTestPersistentApi(fileApisBuffer);
      cache = new PersistentCheckpointStateCache(
        {persistentApis, logger: testLogger(), shufflingCache: new ShufflingCache()},
        {maxEpochsInMemory: 1}
      );
      cache.add(cp0a, states["cp0a"]);
      cache.add(cp0b, states["cp0b"]);
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^           ^    ^
    //                       ||           |    |
    //                       |0b--------root1--root2
    //                       |
    //                       0a
    it("no reorg", async () => {
      expect(fileApisBuffer.size).toEqual(0);
      cache.add(cp1, states["cp1"]);
      expect(await cache.processState(toHexString(cp1.root), states["cp1"])).toEqual(1);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      expect(fileApisBuffer.size).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      const blockStateRoot2 = states["cp1"].clone();
      blockStateRoot2.slot = 21 * SLOTS_PER_EPOCH + 3;
      const root2 = Buffer.alloc(32, 100);
      // process state of root2
      await cache.processState(toHexString(root2), blockStateRoot2);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());

      // epoch 21 has 1 checkpoint state
      expect(cache.get(cp1Hex)).to.be.not.null;
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0aHex)).to.be.null;
      expect(cache.get(cp0bHex)).to.be.null;
      // but cp0bHex is persisted
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      // while cp0aHex is not
      expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^           ^    ^     ^
    //                       ||           |    |     |
    //                       |0b--------root1--root2 |
    //                       |            |---------root3
    //                       0a
    it("reorg in same epoch", async () => {
      // almost the same to "no reorg" test
      expect(fileApisBuffer.size).toEqual(0);
      cache.add(cp1, states["cp1"]);
      expect(await cache.processState(toHexString(cp1.root), states["cp1"])).toEqual(1);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      expect(fileApisBuffer.size).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      const blockStateRoot2 = states["cp1"].clone();
      blockStateRoot2.slot = 21 * SLOTS_PER_EPOCH + 3;
      const root2 = Buffer.alloc(32, 100);
      // process state of root2
      await cache.processState(toHexString(root2), blockStateRoot2);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      const blockStateRoot3 = states["cp1"].clone();
      blockStateRoot3.slot = 21 * SLOTS_PER_EPOCH + 4;
      const root3 = Buffer.alloc(32, 101);
      // process state of root3
      await cache.processState(toHexString(root3), blockStateRoot3);

      // epoch 21 has 1 checkpoint state
      expect(cache.get(cp1Hex)).to.be.not.null;
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0aHex)).to.be.null;
      expect(cache.get(cp0bHex)).to.be.null;
      // but cp0bHex is persisted
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      // while cp0aHex is not
      expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^      ^    ^        ^
    //                       ||      |    |        |
    //                       |0b----1a--root1      |
    //                       |       |----|-------root2
    //                       0a           |
    //                               cp1a={1a, 21}
    it("reorg 1 epoch, no persist 1a", async () => {
      // root 1a
      expect(fileApisBuffer.size).toEqual(0);
      const root1a = Buffer.alloc(32, 100);
      const state1a = states["cp0b"].clone();
      state1a.slot = 20 * SLOTS_PER_EPOCH + SLOTS_PER_EPOCH - 1;
      state1a.blockRoots.set(state1a.slot % SLOTS_PER_HISTORICAL_ROOT, root1a);
      expect(await cache.processState(toHexString(cp1.root), states["cp1"])).toEqual(0);
      expect(fileApisBuffer.size).toEqual(0);
      await assertPersistedCheckpointState([], []);

      // cp1
      cache.add(cp1, states["cp1"]);
      expect(await cache.processState(toHexString(cp1.root), states["cp1"])).toEqual(1);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      expect(fileApisBuffer.size).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());

      // root2, regen cp1a
      const cp1aState = state1a.clone();
      cp1aState.slot = 21 * SLOTS_PER_EPOCH;
      const cp1a = {epoch: 21, root: root1a};
      cache.add(cp1a, cp1aState);
      const blockStateRoot2 = cp1aState.clone();
      blockStateRoot2.slot = 21 * SLOTS_PER_EPOCH + 3;
      const root2 = Buffer.alloc(32, 100);
      // process state of root2
      expect(await cache.processState(toHexString(root2), blockStateRoot2)).toEqual(0);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      // keep these 2 cp states at epoch 21
      expect(cache.get(toCheckpointHex(cp1a))).to.be.not.null;
      expect(cache.get(toCheckpointHex(cp1))).to.be.not.null;
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^           ^        ^
    //                       ||           |        |
    //                       |0b--------root1      |
    //                       ||-----------|-------root2
    //                       0a        {21, 1b}=cp1b
    it("reorg 1 epoch, no persist 0b", async () => {
      expect(fileApisBuffer.size).toEqual(0);
      // cp1
      cache.add(cp1, states["cp1"]);
      expect(await cache.processState(toHexString(cp1.root), states["cp1"])).toEqual(1);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      expect(fileApisBuffer.size).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());

      // simulate regen
      cache.add(cp0b, states["cp0b"]);
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(states["cp0b"]);
      // root2, regen cp0b
      const cp1bState = states["cp0b"].clone();
      cp1bState.slot = 21 * SLOTS_PER_EPOCH;
      const cp1b = {epoch: 21, root: root0b};
      cache.add(cp1b, cp1bState);
      const blockStateRoot2 = cp1bState.clone();
      blockStateRoot2.slot = 21 * SLOTS_PER_EPOCH + 3;
      const root2 = Buffer.alloc(32, 100);
      // process state of root2, nothing is persisted
      expect(await cache.processState(toHexString(root2), blockStateRoot2)).toEqual(0);

      // but cp0b in-memory state is pruned
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      // keep these 2 cp states at epoch 21
      expect(cache.get(toCheckpointHex(cp1b))).to.be.not.null;
      expect(cache.get(toCheckpointHex(cp1))).to.be.not.null;
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^      ^    ^        ^
    //                       ||      |    |        |
    //                       |0b-----|--root1      |
    //                       |       |    |        |
    //                       0a-----1a----|-------root2
    //                                    |
    //                               cp1a={1a, 21}
    it("reorg 1 epoch, persist one more checkpoint state", async () => {
      // root 1a
      expect(fileApisBuffer.size).toEqual(0);
      const root1a = Buffer.alloc(32, 100);
      const state1a = states["cp0a"].clone();
      state1a.slot = 20 * SLOTS_PER_EPOCH + SLOTS_PER_EPOCH - 1;
      state1a.blockRoots.set(state1a.slot % SLOTS_PER_HISTORICAL_ROOT, root1a);
      expect(await cache.processState(toHexString(cp1.root), states["cp1"])).toEqual(0);
      expect(fileApisBuffer.size).toEqual(0);
      // at epoch 20, there should be 2 cps in memory
      expect(cache.get(cp0aHex)).to.be.not.null;
      expect(cache.get(cp0bHex)).to.be.not.null;
      await assertPersistedCheckpointState([], []);

      // cp1
      cache.add(cp1, states["cp1"]);
      expect(await cache.processState(toHexString(cp1.root), states["cp1"])).toEqual(1);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      expect(fileApisBuffer.size).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      // 2 checkpoint states at epoch 20 are pruned
      expect(cache.get(cp0aHex)).to.be.null;
      expect(cache.get(cp0bHex)).to.be.null;
      // only cp0bHex is persisted
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;

      // root2, regen cp0a
      cache.add(cp0a, states["cp0a"]);
      const cp1aState = state1a.clone();
      cp1aState.slot = 21 * SLOTS_PER_EPOCH;
      const cp1a = {epoch: 21, root: root1a};
      cache.add(cp1a, cp1aState);
      const blockStateRoot2 = cp1aState.clone();
      blockStateRoot2.slot = 21 * SLOTS_PER_EPOCH + 3;
      const root2 = Buffer.alloc(32, 100);
      // process state of root2, persist cp0a
      expect(await cache.processState(toHexString(root2), blockStateRoot2)).toEqual(1);
      await assertPersistedCheckpointState([cp0b, cp0a], [stateBytes["cp0b"], stateBytes["cp0a"]]);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      // keep these 2 cp states at epoch 21
      expect(cache.get(toCheckpointHex(cp1a))).to.be.not.null;
      expect(cache.get(toCheckpointHex(cp1))).to.be.not.null;
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^           ^        ^
    //                       ||           |        |
    //                       |0b--------root1      |
    //                       |            |        |
    //                       0a-----------|-------root2
    //                                    |
    //                               cp1a={0a, 21}
    it("reorg 2 epochs", async () => {
      // cp1
      cache.add(cp1, states["cp1"]);
      expect(await cache.processState(toHexString(cp1.root), states["cp1"])).toEqual(1);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      expect(fileApisBuffer.size).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      // 2 checkpoint states at epoch 20 are pruned
      expect(cache.get(cp0aHex)).to.be.null;
      expect(cache.get(cp0bHex)).to.be.null;
      // only cp0bHex is persisted
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;

      // root2, regen cp0a
      cache.add(cp0a, states["cp0a"]);
      const cp1aState = states["cp0a"].clone();
      cp1aState.slot = 21 * SLOTS_PER_EPOCH;
      const cp1a = {epoch: 21, root: root0a};
      cache.add(cp1a, cp1aState);
      const blockStateRoot2 = cp1aState.clone();
      blockStateRoot2.slot = 21 * SLOTS_PER_EPOCH + 3;
      const root2 = Buffer.alloc(32, 100);
      // process state of root2, persist cp0a
      expect(await cache.processState(toHexString(root2), blockStateRoot2)).toEqual(1);
      await assertPersistedCheckpointState([cp0b, cp0a], [stateBytes["cp0b"], stateBytes["cp0a"]]);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      // keep these 2 cp states at epoch 21
      expect(cache.get(toCheckpointHex(cp1a))).to.be.not.null;
      expect(cache.get(toCheckpointHex(cp1))).to.be.not.null;
    });

    describe("processState, maxEpochsInMemory = 0", () => {
      beforeEach(() => {
        fileApisBuffer = new Map();
        const persistentApis = getTestPersistentApi(fileApisBuffer);
        cache = new PersistentCheckpointStateCache(
          {persistentApis, logger: testLogger(), shufflingCache: new ShufflingCache()},
          {maxEpochsInMemory: 0}
        );
        cache.add(cp0a, states["cp0a"]);
        cache.add(cp0b, states["cp0b"]);
      });

      //     epoch: 19         20           21         22          23
      //            |-----------|-----------|-----------|-----------|
      //                       ^^     ^
      //                       ||     |
      //                       |0b --root1a
      //                       |
      //                       0a
      it("no reorg", async () => {
        expect(await cache.processState(toHexString(root0b), states["cp0b"])).toEqual(1);
        await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
        expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);

        const root1a = Buffer.alloc(32, 100);
        const state1a = states["cp0b"].clone();
        state1a.slot = 20 * SLOTS_PER_EPOCH + SLOTS_PER_EPOCH + 3;
        state1a.blockRoots.set(state1a.slot % SLOTS_PER_HISTORICAL_ROOT, root1a);
        expect(await cache.processState(toHexString(root1a), state1a)).toEqual(0);

        // nothing change
        expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      });

      //     epoch: 19         20           21         22          23
      //            |-----------|-----------|-----------|-----------|
      //                       ^^     ^    ^
      //                       ||     |    |
      //                       |0b --root1a|
      //                       |  \        |
      //                       0a  \------root1b
      it("reorg in same epoch", async () => {
        expect(await cache.processState(toHexString(root0b), states["cp0b"])).toEqual(1);
        await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
        expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);

        const root1a = Buffer.alloc(32, 100);
        const state1a = states["cp0b"].clone();
        state1a.slot = 20 * SLOTS_PER_EPOCH + SLOTS_PER_EPOCH + 3;
        state1a.blockRoots.set(state1a.slot % SLOTS_PER_HISTORICAL_ROOT, root1a);
        expect(await cache.processState(toHexString(root1a), state1a)).toEqual(0);

        // nothing change
        expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);

        // simulate reload cp1b
        cache.add(cp0b, states["cp0b"]);
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(states["cp0b"]);
        const root1b = Buffer.alloc(32, 101);
        const state1b = states["cp0b"].clone();
        state1b.slot = state1a.slot + 1;
        state1b.blockRoots.set(state1b.slot % SLOTS_PER_HISTORICAL_ROOT, root1b);
        // but no need to persist cp1b
        expect(await cache.processState(toHexString(root1b), state1b)).toEqual(0);
        // although states["cp0b"] is pruned
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
        expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;
      });

      //     epoch: 19         20           21         22          23
      //            |-----------|-----------|-----------|-----------|
      //                       ^^     ^    ^
      //                       ||     |    |
      //                       |0b --root1a|
      //                       |           |
      //                       0a---------root1b
      it("reorg 1 epoch", async () => {
        expect(await cache.processState(toHexString(root0b), states["cp0b"])).toEqual(1);
        await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
        expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);

        const root1a = Buffer.alloc(32, 100);
        const state1a = states["cp0b"].clone();
        state1a.slot = 20 * SLOTS_PER_EPOCH + SLOTS_PER_EPOCH + 3;
        state1a.blockRoots.set(state1a.slot % SLOTS_PER_HISTORICAL_ROOT, root1a);
        expect(await cache.processState(toHexString(root1a), state1a)).toEqual(0);

        // nothing change
        expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);

        const root1b = Buffer.alloc(32, 101);
        const state1b = states["cp0a"].clone();
        state1b.slot = state1a.slot + 1;
        state1b.blockRoots.set(state1b.slot % SLOTS_PER_HISTORICAL_ROOT, root1b);
        // regen should reload cp0a from disk
        cache.add(cp0a, states["cp0a"]);
        expect(await cache.processState(toHexString(root1b), state1b)).toEqual(1);
        await assertPersistedCheckpointState([cp0b, cp0a], [stateBytes["cp0b"], stateBytes["cp0a"]]);

        // both cp0a and cp0b are persisted
        expect(await cache.getStateOrBytes(cp0aHex)).toEqual(stateBytes["cp0a"]);
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      });

      //     epoch: 19         20           21         22          23
      //            |-----------|-----------|-----------|-----------|
      //                       ^^           ^       ^
      //                       ||           |       |
      //                       |0b--------root1     |
      //                       |                    |
      //                       0a-----------------root2
      //                                    ^
      //                                  {0a, 21}=cp1a
      it("reorg 2 epochs", async () => {
        expect(await cache.processState(toHexString(root0b), states["cp0b"])).toEqual(1);
        await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
        expect(await cache.getStateOrBytes(cp0aHex)).to.be.null;
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);

        cache.add(cp1, states["cp1"]);
        expect(await cache.processState(toHexString(cp1.root), states["cp1"])).toEqual(1);
        await assertPersistedCheckpointState([cp0b, cp1], [stateBytes["cp0b"], stateBytes["cp1"]]);

        // regen should populate cp0a and cp1a checkpoint states
        cache.add(cp0a, states["cp0a"]);
        const cp1a = {epoch: 21, root: root0a};
        const cp1aState = states["cp0a"].clone();
        cp1aState.blockRoots.set((20 * SLOTS_PER_EPOCH) % SLOTS_PER_HISTORICAL_ROOT, root0a);
        cp1aState.blockRoots.set((21 * SLOTS_PER_EPOCH) % SLOTS_PER_HISTORICAL_ROOT, root0a);
        cp1aState.slot = 21 * SLOTS_PER_EPOCH;
        cache.add(cp1a, cp1aState);

        const root2 = Buffer.alloc(32, 100);
        const state2 = cp1aState.clone();
        state2.slot = 21 * SLOTS_PER_EPOCH + 3;
        state2.blockRoots.set(state2.slot % SLOTS_PER_HISTORICAL_ROOT, root2);
        expect(await cache.processState(toHexString(root2), state2)).toEqual(2);
        // expect 4 cp states are persisted
        await assertPersistedCheckpointState(
          [cp0b, cp1, cp0a, cp1a],
          [stateBytes["cp0b"], stateBytes["cp1"], stateBytes["cp0a"], cp1aState.serialize()]
        );
      });
    });
  });

  async function assertPersistedCheckpointState(cps: phase0.Checkpoint[], stateBytesArr: Uint8Array[]): Promise<void> {
    const persistedKeys = cps.map((cp) => toHexString(checkpointToPersistentKey(cp)));
    expect(Array.from(fileApisBuffer.keys())).toStrictEqual(persistedKeys);
    for (const [i, persistedKey] of persistedKeys.entries()) {
      expect(fileApisBuffer.get(persistedKey)).toStrictEqual(stateBytesArr[i]);
    }
    for (const [i, cp] of cps.entries()) {
      const cpHex = toCheckpointHex(cp);
      expect(await cache.getStateOrBytes(cpHex)).toStrictEqual(stateBytesArr[i]);
      // simple get() does not reload from disk
      expect(cache.get(cpHex)).to.be.null;
    }
  }
});
