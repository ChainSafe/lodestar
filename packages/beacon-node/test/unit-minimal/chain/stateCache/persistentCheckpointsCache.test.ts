import {beforeAll, beforeEach, describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {ACTIVE_PRESET, PresetName, SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {
  BeaconStateView,
  IBeaconStateView,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
} from "@lodestar/state-transition";
import {Epoch, RootHex, phase0, ssz} from "@lodestar/types";
import {fromHex, mapValues, toHexString} from "@lodestar/utils";
import {FIFOBlockStateCache} from "../../../../src/chain/index.js";
import {CPStateDatastore, checkpointToDatastoreKey} from "../../../../src/chain/stateCache/datastore/index.js";
import {
  CP_STATE_TIER_BASE,
  PersistentCheckpointStateCache,
  PersistentCheckpointStateCacheOpts,
  toCheckpointHex,
} from "../../../../src/chain/stateCache/persistentCheckpointsCache.js";
import {CacheItemType, CheckpointHex} from "../../../../src/chain/stateCache/types.js";
import {getTestDatastore} from "../../../utils/chain/stateCache/datastore.js";
import {generateCachedState} from "../../../utils/state.js";

describe("PersistentCheckpointStateCache", () => {
  if (ACTIVE_PRESET !== PresetName.minimal) {
    throw Error(`ACTIVE_PRESET '${ACTIVE_PRESET}' must be minimal`);
  }

  let root0a: Buffer, root0b: Buffer, root1: Buffer, root2: Buffer;
  let cp0a: phase0.Checkpoint, cp0b: phase0.Checkpoint, cp1: phase0.Checkpoint, cp2: phase0.Checkpoint;
  let cp0aHex: CheckpointHex, cp0bHex: CheckpointHex, cp1Hex: CheckpointHex, cp2Hex: CheckpointHex;
  let persistent0bKey: RootHex;
  const startSlotEpoch20 = computeStartSlotAtEpoch(20);
  const startSlotEpoch21 = computeStartSlotAtEpoch(21);
  const startSlotEpoch22 = computeStartSlotAtEpoch(22);
  let cache: PersistentCheckpointStateCache;
  let fileApisBuffer: Map<string, Uint8Array>;
  let states: Record<"cp0a" | "cp0b" | "cp1" | "cp2", BeaconStateView>;
  let stateBytes: Record<"cp0a" | "cp0b" | "cp1" | "cp2", Uint8Array>;
  const config = createBeaconConfig(chainConfigDef, Buffer.alloc(32, 0xaa));

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
    persistent0bKey = toHexString(checkpointToDatastoreKey(cp0b));
    const allStates = [cp0a, cp0b, cp1, cp2]
      .map((cp) => generateCachedState({slot: cp.epoch * SLOTS_PER_EPOCH}))
      .map((state, i) => {
        const stateEpoch = computeEpochAtSlot(state.slot);
        if (stateEpoch === 20 && i === 0) {
          // cp0a
          state.blockRoots.set((startSlotEpoch20 - 1) % SLOTS_PER_HISTORICAL_ROOT, root0a);
          state.blockRoots.set(startSlotEpoch20 % SLOTS_PER_HISTORICAL_ROOT, root0a);
          return new BeaconStateView(state);
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
        return new BeaconStateView(state);
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
    const datastore = getTestDatastore(fileApisBuffer);
    cache = new PersistentCheckpointStateCache(
      {
        config,
        datastore,
        logger: testLogger(),
        blockStateCache: new FIFOBlockStateCache({}, {}),
      },
      {maxCPStateEpochsInMemory: 2}
    );
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

  it("getOrReloadLatest", async () => {
    cache.add(cp2, states["cp2"]);
    expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);

    // cp0b is persisted
    expect(fileApisBuffer.size).toEqual(1);
    expect(Array.from(fileApisBuffer.keys())).toEqual([persistent0bKey]);

    // getLatest() does not reload from disk
    expect(cache.getLatest(cp0aHex.rootHex, cp0a.epoch)).toBeNull();
    expect(cache.getLatest(cp0bHex.rootHex, cp0b.epoch)).toBeNull();

    // cp0a has the root from previous epoch so we only prune it from db
    expect(await cache.getOrReloadLatest(cp0aHex.rootHex, cp0a.epoch)).toBeNull();
    // but getOrReloadLatest() does for cp0b
    expect((await cache.getOrReloadLatest(cp0bHex.rootHex, cp0b.epoch))?.serialize()).toEqual(stateBytes["cp0b"]);
    expect((await cache.getOrReloadLatest(cp0bHex.rootHex, cp0b.epoch + 1))?.serialize()).toEqual(stateBytes["cp0b"]);
    expect((await cache.getOrReloadLatest(cp0bHex.rootHex, cp0b.epoch - 1))?.serialize()).toBeUndefined();
  });

  it("pruneFinalized and getStateOrBytes", async () => {
    cache.add(cp2, states["cp2"]);
    expect(((await cache.getStateOrBytes(cp0bHex)) as IBeaconStateView).hashTreeRoot()).toEqual(
      states["cp0b"].hashTreeRoot()
    );
    expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
    // cp0 is persisted
    expect(fileApisBuffer.size).toEqual(1);
    expect(Array.from(fileApisBuffer.keys())).toEqual([persistent0bKey]);
    expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
    // cp1 is in memory
    expect(cache.get(cp1Hex)).not.toBeNull();
    // cp2 is in memory
    expect(cache.get(cp2Hex)).not.toBeNull();
    // finalize epoch 22 via processState: prune is driven by state.finalizedCheckpoint.epoch
    expect(await cache.processState(toHexString(cp2.root), stateWithFinalizedEpoch(22))).toEqual(0);
    expect(fileApisBuffer.size).toEqual(0);
    expect(cache.get(cp1Hex)).toBeNull();
    expect(cache.get(cp2Hex)).not.toBeNull();
    expect(await cache.getStateOrBytes(cp0bHex)).toBeNull();
  });

  // regression: a finalized checkpoint state must be pruned, never persisted (no orphan on disk)
  it("does not persist a finalized checkpoint state", async () => {
    cache.add(cp2, states["cp2"]);
    // state at epoch 22 that finalizes epoch 21 -> epoch 20 must be pruned before any persist
    expect(await cache.processState(toHexString(cp2.root), stateWithFinalizedEpoch(21))).toEqual(0);
    // epoch 20 (cp0a, cp0b) is gone from memory and was never written to disk
    expect(fileApisBuffer.size).toEqual(0);
    expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();
    expect(await cache.getStateOrBytes(cp0bHex)).toBeNull();
    // epoch 21 and 22 are kept
    expect(cache.get(cp1Hex)).not.toBeNull();
    expect(cache.get(cp2Hex)).not.toBeNull();
  });

  // regression: re-add()ing a checkpoint that is already in memory with a persistedKey (e.g. one that
  // was reloaded from disk) must keep that persistedKey. Otherwise its on-disk copy is orphaned, since
  // prune/finalize removes files by the stored persistedKey.
  it("re-adding a reloaded checkpoint keeps its persistedKey (no orphan on disk)", async () => {
    cache.add(cp2, states["cp2"]);
    // persist cp0b to disk
    expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
    expect(Array.from(fileApisBuffer.keys())).toEqual([persistent0bKey]);

    // reload cp0b back into memory -> {inMemory, state, persistedKey}
    expect((await cache.getOrReload(cp0bHex))?.serialize()).toEqual(stateBytes["cp0b"]);

    // re-add the same checkpoint while it is in memory with a persistedKey
    cache.add(cp0b, states["cp0b"]);

    // finalize epoch 21 -> epoch 20 (cp0b) is pruned; its on-disk copy must be removed, not orphaned
    expect(await cache.processState(toHexString(cp2.root), stateWithFinalizedEpoch(21))).toEqual(0);
    expect(fileApisBuffer.has(persistent0bKey)).toBe(false);
    expect(fileApisBuffer.size).toEqual(0);
    expect(await cache.getStateOrBytes(cp0bHex)).toBeNull();
  });

  describe("findSeedStateToReload", () => {
    beforeEach(() => {
      fileApisBuffer = new Map();
      const datastore = getTestDatastore(fileApisBuffer);
      cache = new PersistentCheckpointStateCache(
        {
          config,
          datastore,
          logger: testLogger(),
          blockStateCache: new FIFOBlockStateCache({}, {}),
        },
        {maxCPStateEpochsInMemory: 2}
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
    it("single state at lowest memory epoch", async () => {
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
    it("multiple states at lowest memory epoch", async () => {
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);

      const cp1a = {epoch: 21, root: root0a};
      const cp1aState = states["cp0a"].cachedState.clone();
      cp1aState.slot = 21 * SLOTS_PER_EPOCH;
      cp1aState.blockRoots.set(startSlotEpoch21 % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cp1aState.commit();
      cache.add(cp1a, new BeaconStateView(cp1aState));

      const cp2a = {epoch: 22, root: root0a};
      const cp2aState = cp1aState.clone();
      cp2aState.slot = 22 * SLOTS_PER_EPOCH;
      cp2aState.blockRoots.set(startSlotEpoch22 % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cp2aState.commit();
      cache.add(cp2a, new BeaconStateView(cp2aState));

      const root3 = Buffer.alloc(32, 100);
      const state3 = cp2aState.clone();
      state3.slot = 22 * SLOTS_PER_EPOCH + 3;
      state3.commit();
      await cache.processState(toHexString(root3), new BeaconStateView(state3));

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
      const datastore = getTestDatastore(fileApisBuffer);
      cache = new PersistentCheckpointStateCache(
        {
          config,
          datastore,
          logger: testLogger(),
          blockStateCache: new FIFOBlockStateCache({}, {}),
        },
        {maxCPStateEpochsInMemory: 2}
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
    it("no reorg", async () => {
      expect(fileApisBuffer.size).toEqual(0);
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
      expect(cache.get(cp2Hex)?.hashTreeRoot()).toEqual(states["cp2"].hashTreeRoot());
      expect(fileApisBuffer.size).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      const blockStateRoot3 = states["cp2"].cachedState.clone();
      blockStateRoot3.slot = 22 * SLOTS_PER_EPOCH + 3;
      const root3 = Buffer.alloc(32, 100);
      // process state of root3
      await cache.processState(toHexString(root3), new BeaconStateView(blockStateRoot3));
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      // epoch 22 has 1 checkpoint state
      expect(cache.get(cp2Hex)).not.toBeNull();
      // epoch 21 has 1 checkpoint state
      expect(cache.get(cp1Hex)).not.toBeNull();
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0bHex)).toBeNull();
      // but cp0bHex is persisted
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      // while cp0aHex is not
      expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();
    });

    //     epoch: 19         20           21         22          23
    //            |-----------|-----------|-----------|-----------|
    //                       ^^           ^           ^    ^     ^
    //                       ||           |           |    |     |
    //                       |0b--------root1--------root2-root3 |
    //                       |                        |
    //                       0a                       |---------root4
    it("reorg in same epoch", async () => {
      // mostly the same to the above test
      expect(fileApisBuffer.size).toEqual(0);
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
      expect(cache.get(cp2Hex)?.hashTreeRoot()).toEqual(states["cp2"].hashTreeRoot());
      expect(fileApisBuffer.size).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      const blockStateRoot3 = states["cp2"].cachedState.clone();
      blockStateRoot3.slot = 22 * SLOTS_PER_EPOCH + 3;
      const root3 = Buffer.alloc(32, 100);
      // process state of root3
      await cache.processState(toHexString(root3), new BeaconStateView(blockStateRoot3));
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      const blockStateRoot4 = states["cp2"].cachedState.clone();
      blockStateRoot4.slot = 22 * SLOTS_PER_EPOCH + 4;
      const root4 = Buffer.alloc(32, 101);
      // process state of root4
      await cache.processState(toHexString(root4), new BeaconStateView(blockStateRoot4));
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      // epoch 22 has 1 checkpoint state
      expect(cache.get(cp2Hex)).not.toBeNull();
      // epoch 21 has 1 checkpoint state
      expect(cache.get(cp1Hex)).not.toBeNull();
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0bHex)).toBeNull();
      // but cp0bHex is persisted
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      // while cp0aHex is not
      expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();
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
    it("reorg 1 epoch", async () => {
      // process root2 state
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      // regen generates cp2a
      const root1a = Buffer.alloc(32, 100);
      const cp2a = {epoch: 22, root: root1a};
      const cp2aState = states["cp1"].cachedState.clone();
      cp2aState.slot = 22 * SLOTS_PER_EPOCH;
      // assuming reorg block is at slot 5 of epoch 21
      cp2aState.blockRoots.set((startSlotEpoch21 + 5) % SLOTS_PER_HISTORICAL_ROOT, root1a);
      cp2aState.blockRoots.set(startSlotEpoch22 % SLOTS_PER_HISTORICAL_ROOT, root1a);
      cache.add(cp2a, new BeaconStateView(cp2aState));

      // block state of root3 in epoch 22 is built on cp2a
      const blockStateRoot3 = cp2aState.clone();
      blockStateRoot3.slot = 22 * SLOTS_PER_EPOCH + 3;

      const root3 = Buffer.alloc(32, 101);
      // process state of root3
      await cache.processState(toHexString(root3), new BeaconStateView(blockStateRoot3));
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      // epoch 22 has 2 checkpoint states
      expect(cache.get(cp2Hex)).not.toBeNull();
      expect(cache.get(toCheckpointHex(cp2a))).not.toBeNull();
      // epoch 21 has 1 checkpoint state
      expect(cache.get(cp1Hex)).not.toBeNull();
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0aHex)).toBeNull();
      expect(cache.get(cp0bHex)).toBeNull();
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
    it("reorg 2 epochs", async () => {
      // process root2 state
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      // reload cp0b from disk
      expect((await cache.getOrReload(toCheckpointHex(cp0b)))?.serialize()).toStrictEqual(stateBytes["cp0b"]);

      // regen generates cp1a
      const root0a = Buffer.alloc(32, 100);
      const cp1a = {epoch: 21, root: root0a};
      const cp1aState = states["cp0b"].cachedState.clone();
      cp1aState.slot = 21 * SLOTS_PER_EPOCH;
      // assuming reorg block is at slot 5 of epoch 20
      cp1aState.blockRoots.set((startSlotEpoch20 + 5) % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cache.add(cp1a, new BeaconStateView(cp1aState));

      // regen generates cp2a
      const cp2a = {epoch: 22, root: root0a};
      const cp2aState = cp1aState.clone();
      cp2aState.slot = 22 * SLOTS_PER_EPOCH;
      cp2aState.blockRoots.set(startSlotEpoch22 % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cache.add(cp2a, new BeaconStateView(cp2aState));

      // block state of root3 in epoch 22 is built on cp2a
      const blockStateRoot3 = cp2aState.clone();
      blockStateRoot3.slot = 22 * SLOTS_PER_EPOCH + 3;

      const root3 = Buffer.alloc(32, 101);
      // process state of root3
      await cache.processState(toHexString(root3), new BeaconStateView(blockStateRoot3));
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      // epoch 21 and 22 have 2 checkpoint states
      expect(cache.get(cp1Hex)).not.toBeNull();
      expect(cache.get(toCheckpointHex(cp1a))).not.toBeNull();
      expect(cache.get(cp2Hex)).not.toBeNull();
      expect(cache.get(toCheckpointHex(cp2a))).not.toBeNull();
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0aHex)).toBeNull();
      expect(cache.get(cp0bHex)).toBeNull();
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
    it("reorg 3 epochs, persist cp 0a", async () => {
      // process root2 state
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      // cp0a was pruned from memory and not in disc
      expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();

      // regen needs to regen cp0a
      cache.add(cp0a, states["cp0a"]);

      // regen generates cp1a
      const cp1a = {epoch: 21, root: root0a};
      const cp1aState = generateCachedState({slot: 21 * SLOTS_PER_EPOCH});
      cp1aState.blockRoots.set((startSlotEpoch20 - 1) % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cp1aState.blockRoots.set(startSlotEpoch20 % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cache.add(cp1a, new BeaconStateView(cp1aState));

      // regen generates cp2a
      const cp2a = {epoch: 22, root: root0a};
      const cp2aState = cp1aState.clone();
      cp2aState.slot = 22 * SLOTS_PER_EPOCH;
      cp2aState.blockRoots.set(startSlotEpoch21 % SLOTS_PER_HISTORICAL_ROOT, root0a);
      cache.add(cp2a, new BeaconStateView(cp2aState));

      // block state of root3 in epoch 22 is built on cp2a
      const blockStateRoot3 = cp2aState.clone();
      blockStateRoot3.slot = 22 * SLOTS_PER_EPOCH + 3;
      blockStateRoot3.blockRoots.set(startSlotEpoch22 % SLOTS_PER_HISTORICAL_ROOT, root0a);

      // regen populates cache when producing blockStateRoot3

      const root3 = Buffer.alloc(32, 100);
      // process state of root3
      expect(await cache.processState(toHexString(root3), new BeaconStateView(blockStateRoot3))).toEqual(1);
      await assertPersistedCheckpointState([cp0b, cp0a], [stateBytes["cp0b"], stateBytes["cp0a"]]);
      // epoch 21 and 22 have 2 checkpoint states
      expect(cache.get(cp1Hex)).not.toBeNull();
      expect(cache.get(toCheckpointHex(cp1a))).not.toBeNull();
      expect(cache.get(cp2Hex)).not.toBeNull();
      expect(cache.get(toCheckpointHex(cp2a))).not.toBeNull();
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0aHex)).toBeNull();
      expect(cache.get(cp0bHex)).toBeNull();
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
    it("reorg 3 epochs, prune but no persist", async () => {
      // process root2 state
      cache.add(cp2, states["cp2"]);
      expect(await cache.processState(toHexString(cp2.root), states["cp2"])).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      // cp0a was pruned from memory and not in disc
      expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();

      // regen needs to reload cp0b
      cache.add(cp0b, states["cp0b"]);
      expect(((await cache.getStateOrBytes(cp0bHex)) as IBeaconStateView).hashTreeRoot()).toEqual(
        states["cp0b"].hashTreeRoot()
      );

      // regen generates cp1b
      const cp1b = {epoch: 21, root: root0b};
      const cp1bState = states["cp0b"].cachedState.clone();
      cp1bState.slot = 21 * SLOTS_PER_EPOCH;
      cp1bState.blockRoots.set(startSlotEpoch21 % SLOTS_PER_HISTORICAL_ROOT, root0b);
      cache.add(cp1b, new BeaconStateView(cp1bState));

      // regen generates cp2b
      const cp2b = {epoch: 22, root: root0b};
      const cp2bState = cp1bState.clone();
      cp2bState.slot = 22 * SLOTS_PER_EPOCH;
      cp2bState.blockRoots.set(startSlotEpoch22 % SLOTS_PER_HISTORICAL_ROOT, root0b);
      cache.add(cp2b, new BeaconStateView(cp2bState));

      // block state of root3 in epoch 22 is built on cp2a
      const blockStateRoot3 = cp2bState.clone();
      blockStateRoot3.slot = 22 * SLOTS_PER_EPOCH + 3;
      const root3 = Buffer.alloc(32, 100);
      // process state of root3, nothing is persisted
      expect(await cache.processState(toHexString(root3), new BeaconStateView(blockStateRoot3))).toEqual(0);
      // but state of cp0b is pruned from memory
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      // epoch 21 and 22 have 2 checkpoint states
      expect(cache.get(cp1Hex)).not.toBeNull();
      expect(cache.get(toCheckpointHex(cp1b))).not.toBeNull();
      expect(cache.get(cp2Hex)).not.toBeNull();
      expect(cache.get(toCheckpointHex(cp2b))).not.toBeNull();
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0aHex)).toBeNull();
      expect(cache.get(cp0bHex)).toBeNull();
    });
  });

  describe("processState, maxEpochsInMemory = 1", () => {
    beforeEach(() => {
      fileApisBuffer = new Map();
      const datastore = getTestDatastore(fileApisBuffer);
      cache = new PersistentCheckpointStateCache(
        {
          config,
          datastore,
          logger: testLogger(),
          blockStateCache: new FIFOBlockStateCache({}, {}),
        },
        {maxCPStateEpochsInMemory: 1}
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

      const blockStateRoot2 = states["cp1"].cachedState.clone();
      blockStateRoot2.slot = 21 * SLOTS_PER_EPOCH + 3;
      const root2 = Buffer.alloc(32, 100);
      // process state of root2
      await cache.processState(toHexString(root2), new BeaconStateView(blockStateRoot2));
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());

      // epoch 21 has 1 checkpoint state
      expect(cache.get(cp1Hex)).not.toBeNull();
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0aHex)).toBeNull();
      expect(cache.get(cp0bHex)).toBeNull();
      // but cp0bHex is persisted
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      // while cp0aHex is not
      expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();
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

      const blockStateRoot2 = states["cp1"].cachedState.clone();
      blockStateRoot2.slot = 21 * SLOTS_PER_EPOCH + 3;
      const root2 = Buffer.alloc(32, 100);
      // process state of root2
      await cache.processState(toHexString(root2), new BeaconStateView(blockStateRoot2));
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);

      const blockStateRoot3 = states["cp1"].cachedState.clone();
      blockStateRoot3.slot = 21 * SLOTS_PER_EPOCH + 4;
      const root3 = Buffer.alloc(32, 101);
      // process state of root3
      await cache.processState(toHexString(root3), new BeaconStateView(blockStateRoot3));

      // epoch 21 has 1 checkpoint state
      expect(cache.get(cp1Hex)).not.toBeNull();
      // epoch 20 has 0 checkpoint state
      expect(cache.get(cp0aHex)).toBeNull();
      expect(cache.get(cp0bHex)).toBeNull();
      // but cp0bHex is persisted
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      // while cp0aHex is not
      expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();
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
      const state1a = states["cp0b"].cachedState.clone();
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
      cache.add(cp1a, new BeaconStateView(cp1aState));
      const blockStateRoot2 = cp1aState.clone();
      blockStateRoot2.slot = 21 * SLOTS_PER_EPOCH + 3;
      const root2 = Buffer.alloc(32, 100);
      // process state of root2
      expect(await cache.processState(toHexString(root2), new BeaconStateView(blockStateRoot2))).toEqual(0);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      // keep these 2 cp states at epoch 21
      expect(cache.get(toCheckpointHex(cp1a))).not.toBeNull();
      expect(cache.get(toCheckpointHex(cp1))).not.toBeNull();
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
      expect(((await cache.getStateOrBytes(cp0bHex)) as IBeaconStateView).hashTreeRoot()).toEqual(
        states["cp0b"].hashTreeRoot()
      );
      // root2, regen cp0b
      const cp1bState = states["cp0b"].cachedState.clone();
      cp1bState.slot = 21 * SLOTS_PER_EPOCH;
      const cp1b = {epoch: 21, root: root0b};
      cache.add(cp1b, new BeaconStateView(cp1bState));
      const blockStateRoot2 = cp1bState.clone();
      blockStateRoot2.slot = 21 * SLOTS_PER_EPOCH + 3;
      const root2 = Buffer.alloc(32, 100);
      // process state of root2, nothing is persisted
      expect(await cache.processState(toHexString(root2), new BeaconStateView(blockStateRoot2))).toEqual(0);

      // but cp0b in-memory state is pruned
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      // keep these 2 cp states at epoch 21
      expect(cache.get(toCheckpointHex(cp1b))).not.toBeNull();
      expect(cache.get(toCheckpointHex(cp1))).not.toBeNull();
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
      const state1a = states["cp0a"].cachedState.clone();
      state1a.slot = 20 * SLOTS_PER_EPOCH + SLOTS_PER_EPOCH - 1;
      state1a.blockRoots.set(state1a.slot % SLOTS_PER_HISTORICAL_ROOT, root1a);
      expect(await cache.processState(toHexString(cp1.root), states["cp1"])).toEqual(0);
      expect(fileApisBuffer.size).toEqual(0);
      // at epoch 20, there should be 2 cps in memory
      expect(cache.get(cp0aHex)).not.toBeNull();
      expect(cache.get(cp0bHex)).not.toBeNull();
      await assertPersistedCheckpointState([], []);

      // cp1
      cache.add(cp1, states["cp1"]);
      expect(await cache.processState(toHexString(cp1.root), states["cp1"])).toEqual(1);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      expect(fileApisBuffer.size).toEqual(1);
      await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      // 2 checkpoint states at epoch 20 are pruned
      expect(cache.get(cp0aHex)).toBeNull();
      expect(cache.get(cp0bHex)).toBeNull();
      // only cp0bHex is persisted
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();

      // root2, regen cp0a
      cache.add(cp0a, states["cp0a"]);
      const cp1aState = state1a.clone();
      cp1aState.slot = 21 * SLOTS_PER_EPOCH;
      const cp1a = {epoch: 21, root: root1a};
      cache.add(cp1a, new BeaconStateView(cp1aState));
      const blockStateRoot2 = cp1aState.clone();
      blockStateRoot2.slot = 21 * SLOTS_PER_EPOCH + 3;
      const root2 = Buffer.alloc(32, 100);
      // process state of root2, persist cp0a
      expect(await cache.processState(toHexString(root2), new BeaconStateView(blockStateRoot2))).toEqual(1);
      await assertPersistedCheckpointState([cp0b, cp0a], [stateBytes["cp0b"], stateBytes["cp0a"]]);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      // keep these 2 cp states at epoch 21
      expect(cache.get(toCheckpointHex(cp1a))).not.toBeNull();
      expect(cache.get(toCheckpointHex(cp1))).not.toBeNull();
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
      expect(cache.get(cp0aHex)).toBeNull();
      expect(cache.get(cp0bHex)).toBeNull();
      // only cp0bHex is persisted
      expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
      expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();

      // root2, regen cp0a
      cache.add(cp0a, states["cp0a"]);
      const cp1aState = states["cp0a"].cachedState.clone();
      cp1aState.slot = 21 * SLOTS_PER_EPOCH;
      const cp1a = {epoch: 21, root: root0a};
      cache.add(cp1a, new BeaconStateView(cp1aState));
      const blockStateRoot2 = cp1aState.clone();
      blockStateRoot2.slot = 21 * SLOTS_PER_EPOCH + 3;
      const root2 = Buffer.alloc(32, 100);
      // process state of root2, persist cp0a
      expect(await cache.processState(toHexString(root2), new BeaconStateView(blockStateRoot2))).toEqual(1);
      await assertPersistedCheckpointState([cp0b, cp0a], [stateBytes["cp0b"], stateBytes["cp0a"]]);
      expect(cache.get(cp1Hex)?.hashTreeRoot()).toEqual(states["cp1"].hashTreeRoot());
      // keep these 2 cp states at epoch 21
      expect(cache.get(toCheckpointHex(cp1a))).not.toBeNull();
      expect(cache.get(toCheckpointHex(cp1))).not.toBeNull();
    });

    describe("processState, maxEpochsInMemory = 0", () => {
      beforeEach(() => {
        fileApisBuffer = new Map();
        const datastore = getTestDatastore(fileApisBuffer);
        cache = new PersistentCheckpointStateCache(
          {
            config,
            datastore,
            logger: testLogger(),
            blockStateCache: new FIFOBlockStateCache({}, {}),
          },
          {maxCPStateEpochsInMemory: 0}
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
        expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);

        const root1a = Buffer.alloc(32, 100);
        const state1a = states["cp0b"].cachedState.clone();
        state1a.slot = 20 * SLOTS_PER_EPOCH + SLOTS_PER_EPOCH + 3;
        state1a.blockRoots.set(state1a.slot % SLOTS_PER_HISTORICAL_ROOT, root1a);
        expect(await cache.processState(toHexString(root1a), new BeaconStateView(state1a))).toEqual(0);

        // nothing change
        expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();
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
        expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);

        const root1a = Buffer.alloc(32, 100);
        const state1a = states["cp0b"].cachedState.clone();
        state1a.slot = 20 * SLOTS_PER_EPOCH + SLOTS_PER_EPOCH + 3;
        state1a.blockRoots.set(state1a.slot % SLOTS_PER_HISTORICAL_ROOT, root1a);
        expect(await cache.processState(toHexString(root1a), new BeaconStateView(state1a))).toEqual(0);

        // nothing change
        expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);

        // simulate reload cp1b
        cache.add(cp0b, states["cp0b"]);
        expect(((await cache.getStateOrBytes(cp0bHex)) as IBeaconStateView).hashTreeRoot()).toEqual(
          states["cp0b"].hashTreeRoot()
        );
        const root1b = Buffer.alloc(32, 101);
        const state1b = states["cp0b"].cachedState.clone();
        state1b.slot = state1a.slot + 1;
        state1b.blockRoots.set(state1b.slot % SLOTS_PER_HISTORICAL_ROOT, root1b);
        // but no need to persist cp1b
        expect(await cache.processState(toHexString(root1b), new BeaconStateView(state1b))).toEqual(0);
        // although states["cp0b"] is pruned
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
        expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();
      });

      // Real mainnet scenario: root1b reorg root1a, and later on it's reorged back to root1a
      // processState is skipped for root1a because it's late, it's only called for root1b
      // we should persist both checkpoint states {0a, 20} and {0b, 20} in order to have finalized checkpoint states later
      //    - {0a, 20} is persisted because it's the view of root1b state
      //    - {0b, 20} is persisted because it's unknown in root1b state
      //     epoch: 19         20           21         22          23
      //            |-----------|-----------|-----------|-----------|
      //                       ^^     ^    ^
      //                       ||     |    |
      //                       |0b --root1a|
      //                       |           |
      //                       0a---------root1b
      it("reorg 1 epoch, processState once", async () => {
        fileApisBuffer = new Map();
        const datastore = getTestDatastore(fileApisBuffer);
        cache = new PersistentCheckpointStateCache(
          {
            config,
            datastore,
            logger: testLogger(),
            blockStateCache: new FIFOBlockStateCache({}, {}),
          },
          {maxCPStateEpochsInMemory: 0}
        );

        const root1a = Buffer.alloc(32, 100);
        const state1a = states["cp0b"].cachedState.clone();
        state1a.slot = 20 * SLOTS_PER_EPOCH + SLOTS_PER_EPOCH + 3;
        state1a.blockRoots.set(state1a.slot % SLOTS_PER_HISTORICAL_ROOT, root1a);
        // state transition add to cache
        cache.add(cp0b, states["cp0b"]);
        // do not processState root1a because it's late

        // no need to reload cp0b because it's available in block state
        const root1b = Buffer.alloc(32, 101);
        const state1b = states["cp0a"].cachedState.clone();
        state1b.slot = state1a.slot + 1;
        state1b.blockRoots.set(state1b.slot % SLOTS_PER_HISTORICAL_ROOT, root1b);
        // state transition add to cache
        cache.add(cp0a, states["cp0a"]);

        // need to persist 2 checkpoint states
        expect(await cache.processState(toHexString(root1b), new BeaconStateView(state1b))).toEqual(2);
        // both are persisited
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);
        expect(await cache.getStateOrBytes(cp0aHex)).toEqual(stateBytes["cp0a"]);
      });

      // Same to above, but we processState for both root1a and root1b
      //     epoch: 19         20           21         22          23
      //            |-----------|-----------|-----------|-----------|
      //                       ^^     ^    ^
      //                       ||     |    |
      //                       |0b --root1a|
      //                       |           |
      //                       0a---------root1b
      it("reorg 1 epoch, processState twice", async () => {
        expect(await cache.processState(toHexString(root0b), states["cp0b"])).toEqual(1);
        await assertPersistedCheckpointState([cp0b], [stateBytes["cp0b"]]);
        expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);

        const root1a = Buffer.alloc(32, 100);
        const state1a = states["cp0b"].cachedState.clone();
        state1a.slot = 20 * SLOTS_PER_EPOCH + SLOTS_PER_EPOCH + 3;
        state1a.blockRoots.set(state1a.slot % SLOTS_PER_HISTORICAL_ROOT, root1a);
        expect(await cache.processState(toHexString(root1a), new BeaconStateView(state1a))).toEqual(0);

        // nothing change
        expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);

        const root1b = Buffer.alloc(32, 101);
        const state1b = states["cp0a"].cachedState.clone();
        state1b.slot = state1a.slot + 1;
        state1b.blockRoots.set(state1b.slot % SLOTS_PER_HISTORICAL_ROOT, root1b);
        // regen should reload cp0a from disk
        cache.add(cp0a, states["cp0a"]);
        expect(await cache.processState(toHexString(root1b), new BeaconStateView(state1b))).toEqual(1);
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
        expect(await cache.getStateOrBytes(cp0aHex)).toBeNull();
        expect(await cache.getStateOrBytes(cp0bHex)).toEqual(stateBytes["cp0b"]);

        cache.add(cp1, states["cp1"]);
        expect(await cache.processState(toHexString(cp1.root), states["cp1"])).toEqual(1);
        await assertPersistedCheckpointState([cp0b, cp1], [stateBytes["cp0b"], stateBytes["cp1"]]);

        // regen should populate cp0a and cp1a checkpoint states
        cache.add(cp0a, states["cp0a"]);
        const cp1a = {epoch: 21, root: root0a};
        const cp1aState = states["cp0a"].cachedState.clone();
        cp1aState.blockRoots.set((20 * SLOTS_PER_EPOCH) % SLOTS_PER_HISTORICAL_ROOT, root0a);
        cp1aState.blockRoots.set((21 * SLOTS_PER_EPOCH) % SLOTS_PER_HISTORICAL_ROOT, root0a);
        cp1aState.slot = 21 * SLOTS_PER_EPOCH;
        cache.add(cp1a, new BeaconStateView(cp1aState));

        const root2 = Buffer.alloc(32, 100);
        const state2 = cp1aState.clone();
        state2.slot = 21 * SLOTS_PER_EPOCH + 3;
        state2.blockRoots.set(state2.slot % SLOTS_PER_HISTORICAL_ROOT, root2);
        expect(await cache.processState(toHexString(root2), new BeaconStateView(state2))).toEqual(2);
        // expect 4 cp states are persisted
        await assertPersistedCheckpointState(
          [cp0b, cp1, cp0a, cp1a],
          [stateBytes["cp0b"], stateBytes["cp1"], stateBytes["cp0a"], cp1aState.serialize()]
        );
      });
    });
  });

  describe("tiered pruning", () => {
    /** Fresh cache + datastore + fileApisBuffer trio for tiered-pruning tests. */
    function createTieredCache(opts: Partial<PersistentCheckpointStateCacheOpts> = {}): {
      cache: PersistentCheckpointStateCache;
      datastore: CPStateDatastore;
      fileApisBuffer: Map<string, Uint8Array>;
    } {
      const fileApisBuffer = new Map<string, Uint8Array>();
      const datastore = getTestDatastore(fileApisBuffer);
      const cache = new PersistentCheckpointStateCache(
        {
          config,
          datastore,
          logger: testLogger(),
          blockStateCache: new FIFOBlockStateCache({}, {}),
        },
        {maxCPStateEpochsInMemory: 0, ...opts}
      );
      return {cache, datastore, fileApisBuffer};
    }

    function rootHexForEpoch(epoch: number, variant = 0): RootHex {
      const buf = Buffer.alloc(32);
      buf.writeUInt32BE(epoch >>> 0, 0);
      buf[4] = variant;
      return toHexString(buf);
    }

    function datastoreKeyHexFor(epoch: Epoch, rootHex: RootHex): string {
      return toHexString(checkpointToDatastoreKey({epoch, root: fromHex(rootHex)}));
    }

    /** Per-tier epoch keys of the on-disk retention tiers, read from the private field (test-only). */
    function dumpTiers(cache: PersistentCheckpointStateCache): Epoch[][] {
      const tiers = (cache as any).persistentTiers as Map<Epoch, Set<RootHex>>[];
      return tiers.map((tierMap) => Array.from(tierMap.keys()).sort((a, b) => a - b));
    }

    /**
     * Simulate a real "persist to disk" for {epoch, rootHex}: writes real bytes to the datastore (so
     * fileApisBuffer reflects it), marks the checkpoint as persisted in the cache's internal bookkeeping
     * (cache + epochIndex) so deleteAllEpochItems() can find and remove it, then runs the tiered-retention
     * cascade exactly as processPastEpoch() does at its persist site. Bypasses full state-transition
     * plumbing since the cascade only depends on epoch/rootHex bookkeeping, not on actual state content.
     */
    async function persistEpoch(
      cache: PersistentCheckpointStateCache,
      datastore: CPStateDatastore,
      epoch: Epoch,
      rootHex: RootHex
    ): Promise<void> {
      const persistedKey = await datastore.write({epoch, root: fromHex(rootHex)}, new Uint8Array([epoch % 256]));
      const cacheAny = cache as any;
      cacheAny.cache.set(`${rootHex}_${epoch}`, {type: CacheItemType.persisted, value: persistedKey});
      cacheAny.epochIndex.getOrDefault(epoch).add(rootHex);
      await cacheAny.onPersist(epoch, rootHex);
    }

    /** Directly seed an already-persisted epoch straight into tier `tier` (skipping lower tiers). */
    async function seedTierEntry(
      cache: PersistentCheckpointStateCache,
      datastore: CPStateDatastore,
      epoch: Epoch,
      rootHex: RootHex,
      tier: number
    ): Promise<void> {
      const persistedKey = await datastore.write({epoch, root: fromHex(rootHex)}, new Uint8Array([epoch % 256]));
      const cacheAny = cache as any;
      cacheAny.cache.set(`${rootHex}_${epoch}`, {type: CacheItemType.persisted, value: persistedKey});
      cacheAny.epochIndex.getOrDefault(epoch).add(rootHex);
      while (cacheAny.persistentTiers.length <= tier) {
        cacheAny.persistentTiers.push(new Map());
      }
      const tierMap = cacheAny.persistentTiers[tier] as Map<Epoch, Set<RootHex>>;
      const roots = tierMap.get(epoch) ?? new Set<RootHex>();
      roots.add(rootHex);
      tierMap.set(epoch, roots);
    }

    describe("alignedForTier", () => {
      it("matches (epoch - finalizedEpoch) % base**tier === 0; F aligns at every tier", () => {
        const {cache} = createTieredCache();
        const base = CP_STATE_TIER_BASE;
        const finalizedEpoch = 100;
        cache.prune(finalizedEpoch, finalizedEpoch);
        const aligned = (epoch: number, tier: number): boolean => (cache as any).alignedForTier(epoch, tier);

        for (let tier = 0; tier <= 3; tier++) {
          expect(aligned(finalizedEpoch, tier)).toBe(true);
        }

        for (const epoch of [
          finalizedEpoch - 3,
          finalizedEpoch - 1,
          finalizedEpoch,
          finalizedEpoch + 1,
          finalizedEpoch + 3,
          finalizedEpoch + base,
          finalizedEpoch + base * 2,
          finalizedEpoch + base ** 2,
        ]) {
          for (const tier of [0, 1, 2]) {
            expect(aligned(epoch, tier)).toBe((epoch - finalizedEpoch) % base ** tier === 0);
          }
        }
      });

      it("exactly 1-in-base of consecutive epochs align at tier 1", () => {
        const {cache} = createTieredCache();
        const base = CP_STATE_TIER_BASE;
        const finalizedEpoch = 10;
        cache.prune(finalizedEpoch, finalizedEpoch);
        const aligned = (epoch: number, tier: number): boolean => (cache as any).alignedForTier(epoch, tier);
        let alignedCount = 0;
        for (let epoch = finalizedEpoch; epoch < finalizedEpoch + base; epoch++) {
          if (aligned(epoch, 1)) alignedCount++;
        }
        expect(alignedCount).toBe(1);
      });
    });

    describe.each([0, 1, 2, 3])("cascade at tier %i (base = CP_STATE_TIER_BASE)", (n) => {
      const base = CP_STATE_TIER_BASE;
      const spacing = base ** n;

      it("evicted epoch NOT aligned to the next tier is deleted from disk and from all tier buckets", async () => {
        const {cache, datastore, fileApisBuffer} = createTieredCache();
        cache.prune(0, 0);
        // base+1 consecutive multiples of `spacing`, starting at k=1: the smallest (k=1) is never a
        // multiple of `base` (base > 1), so it does not align to tier n+1 -> pruned on overflow.
        const epochs = Array.from({length: base + 1}, (_, i) => spacing * (i + 1));
        const root1 = rootHexForEpoch(epochs[0]);
        await seedTierEntry(cache, datastore, epochs[0], root1, n);
        for (const epoch of epochs.slice(1)) {
          await seedTierEntry(cache, datastore, epoch, rootHexForEpoch(epoch), n);
        }
        await (cache as any).prunePersistentTier(n);

        expect(fileApisBuffer.has(datastoreKeyHexFor(epochs[0], root1))).toBe(false);
        for (const tierEpochs of dumpTiers(cache)) {
          expect(tierEpochs).not.toContain(epochs[0]);
        }
        expect(dumpTiers(cache)[n]).toEqual(epochs.slice(1));
      });

      it("evicted epoch aligned to the next tier is promoted, stays on disk, and leaves tier n", async () => {
        const {cache, datastore, fileApisBuffer} = createTieredCache();
        cache.prune(0, 0);
        // base+1 consecutive multiples of `spacing`, starting at k=base: the smallest (k=base) IS a
        // multiple of `base`, so it aligns to tier n+1 -> promoted on overflow.
        const epochs = Array.from({length: base + 1}, (_, i) => spacing * (base + i));
        const root1 = rootHexForEpoch(epochs[0]);
        await seedTierEntry(cache, datastore, epochs[0], root1, n);
        for (const epoch of epochs.slice(1)) {
          await seedTierEntry(cache, datastore, epoch, rootHexForEpoch(epoch), n);
        }
        await (cache as any).prunePersistentTier(n);

        expect(fileApisBuffer.has(datastoreKeyHexFor(epochs[0], root1))).toBe(true);
        expect(dumpTiers(cache)[n]).toEqual(epochs.slice(1));
        expect(dumpTiers(cache)[n + 1]).toEqual([epochs[0]]);
      });
    });

    describe("multi-root epoch", () => {
      it("an epoch with 2 persisted roots keeps both together on promote", async () => {
        const {cache, datastore, fileApisBuffer} = createTieredCache();
        cache.prune(0, 0);
        const base = CP_STATE_TIER_BASE;
        // anchor is a multiple of `base` -> aligned to tier1, so it is promoted (not pruned) on overflow
        const anchor = base;
        const rootA = rootHexForEpoch(anchor, 0);
        const rootB = rootHexForEpoch(anchor, 1);
        await persistEpoch(cache, datastore, anchor, rootA);
        await persistEpoch(cache, datastore, anchor, rootB);
        expect(dumpTiers(cache)[0]).toEqual([anchor]);
        expect((cache as any).persistentTiers[0].get(anchor).size).toBe(2);

        // fill tier0 to capacity (`base` epoch keys total) without overflowing yet
        for (let epoch = anchor + 1; epoch < anchor + base; epoch++) {
          await persistEpoch(cache, datastore, epoch, rootHexForEpoch(epoch));
        }
        expect(dumpTiers(cache)[0].length).toBe(base);

        // one more epoch overflows tier0: evict oldest (anchor), aligned -> promoted with both roots
        await persistEpoch(cache, datastore, anchor + base, rootHexForEpoch(anchor + base));

        expect(dumpTiers(cache)[1]).toEqual([anchor]);
        expect(fileApisBuffer.has(datastoreKeyHexFor(anchor, rootA))).toBe(true);
        expect(fileApisBuffer.has(datastoreKeyHexFor(anchor, rootB))).toBe(true);
      });

      it("an epoch with 2 persisted roots is removed together on prune", async () => {
        const {cache, datastore, fileApisBuffer} = createTieredCache();
        cache.prune(0, 0);
        const base = CP_STATE_TIER_BASE;
        // anchor is NOT a multiple of `base` -> not aligned to tier1, so it is pruned on overflow
        const anchor = 1;
        const rootA = rootHexForEpoch(anchor, 0);
        const rootB = rootHexForEpoch(anchor, 1);
        await persistEpoch(cache, datastore, anchor, rootA);
        await persistEpoch(cache, datastore, anchor, rootB);

        // fill tier0 to capacity (`base` epoch keys total) without overflowing yet
        for (let epoch = anchor + 1; epoch <= base; epoch++) {
          await persistEpoch(cache, datastore, epoch, rootHexForEpoch(epoch));
        }
        expect(dumpTiers(cache)[0].length).toBe(base);

        // one more epoch overflows tier0: evict oldest (anchor), unaligned -> both roots deleted
        await persistEpoch(cache, datastore, base + 1, rootHexForEpoch(base + 1));

        expect(dumpTiers(cache).flat()).not.toContain(anchor);
        expect(fileApisBuffer.has(datastoreKeyHexFor(anchor, rootA))).toBe(false);
        expect(fileApisBuffer.has(datastoreKeyHexFor(anchor, rootB))).toBe(false);
      });
    });

    describe("pins (justifiedEpoch guard)", () => {
      it("a justified epoch is never evicted (stays tracked in its tier, not orphaned) and is evicted once justified advances past it", async () => {
        const base = CP_STATE_TIER_BASE;
        // epoch 1 is not a multiple of `base`, so it is normally pruned (not promoted) on overflow
        const pinnedEpoch = 1;

        // Case A: justifiedEpoch stays pinned to `pinnedEpoch` through the overflow -> it is skipped as
        // the eviction victim, so it stays TRACKED in its tier (not orphaned off-tier) and on disk.
        {
          const {cache, datastore, fileApisBuffer} = createTieredCache();
          const root1 = rootHexForEpoch(pinnedEpoch);
          cache.prune(0, pinnedEpoch); // finalizedEpoch=0, justifiedEpoch=pinnedEpoch
          await persistEpoch(cache, datastore, pinnedEpoch, root1);
          // fill tier0 to capacity (`base` epoch keys total) without overflowing yet
          for (let epoch = pinnedEpoch + 1; epoch <= base; epoch++) {
            await persistEpoch(cache, datastore, epoch, rootHexForEpoch(epoch));
          }
          // overflow tier0: the oldest is pinnedEpoch, but it is the justified pin -> the next-oldest
          // (epoch 2) is evicted instead; pinnedEpoch stays tracked in tier0 and on disk.
          await persistEpoch(cache, datastore, base + 1, rootHexForEpoch(base + 1));

          expect(fileApisBuffer.has(datastoreKeyHexFor(pinnedEpoch, root1))).toBe(true);
          expect(dumpTiers(cache)[0]).toContain(pinnedEpoch); // tracked, NOT orphaned
          expect(fileApisBuffer.has(datastoreKeyHexFor(2, rootHexForEpoch(2)))).toBe(false); // evicted instead

          // once justified advances off pinnedEpoch, a further overflow evicts it normally (unaligned -> deleted)
          cache.prune(0, base + 2);
          await persistEpoch(cache, datastore, base + 2, rootHexForEpoch(base + 2));
          expect(fileApisBuffer.has(datastoreKeyHexFor(pinnedEpoch, root1))).toBe(false);
          expect(dumpTiers(cache).flat()).not.toContain(pinnedEpoch);
        }

        // Case B: justifiedEpoch advances off `pinnedEpoch` before the overflow happens -> pinnedEpoch is
        // the eviction victim and is pruned normally (not guarded).
        {
          const {cache, datastore, fileApisBuffer} = createTieredCache();
          const root1 = rootHexForEpoch(pinnedEpoch);
          cache.prune(0, pinnedEpoch);
          await persistEpoch(cache, datastore, pinnedEpoch, root1);
          for (let epoch = pinnedEpoch + 1; epoch <= base; epoch++) {
            await persistEpoch(cache, datastore, epoch, rootHexForEpoch(epoch));
          }
          cache.prune(0, pinnedEpoch + 1); // advance justifiedEpoch off pinnedEpoch
          await persistEpoch(cache, datastore, base + 1, rootHexForEpoch(base + 1));

          expect(fileApisBuffer.has(datastoreKeyHexFor(pinnedEpoch, root1))).toBe(false);
          expect(dumpTiers(cache).flat()).not.toContain(pinnedEpoch);
        }
      });
    });

    describe("long-leak simulation", () => {
      // 60 consecutive epochs comfortably overflows tier0 (cap = CP_STATE_TIER_BASE = 16) more than
      // once and promotes at least one epoch into tier1.
      const totalEpochs = 60;

      it("persisted states stay bounded (not linear in epochs), and the finalized anchor epoch never gets evicted", async () => {
        const {cache, datastore, fileApisBuffer} = createTieredCache();
        const finalizedEpoch = 1;
        cache.prune(finalizedEpoch, finalizedEpoch); // finalized frozen: no pruneFinalized() call in this test
        for (let epoch = finalizedEpoch; epoch < finalizedEpoch + totalEpochs; epoch++) {
          await persistEpoch(cache, datastore, epoch, rootHexForEpoch(epoch));
        }

        // bounded: far fewer states survive than were ever persisted
        expect(fileApisBuffer.size).toBeGreaterThan(0);
        expect(fileApisBuffer.size).toBeLessThan(totalEpochs);
        // tier0 overflowed (stays at cap) and at least one epoch promoted into tier1
        expect(dumpTiers(cache)[0].length).toBeLessThanOrEqual(CP_STATE_TIER_BASE);
        expect(dumpTiers(cache)[1]?.length ?? 0).toBeGreaterThan(0);

        // the finalized anchor epoch (offset 0, aligned at every tier) is never evicted
        expect(fileApisBuffer.has(datastoreKeyHexFor(finalizedEpoch, rootHexForEpoch(finalizedEpoch)))).toBe(true);
        expect(dumpTiers(cache).flat()).toContain(finalizedEpoch);
      });

      it("retains at most CP_STATE_TIER_BASE states per tier, so disk grows O(base × tiers), not linearly", async () => {
        const {cache, datastore, fileApisBuffer} = createTieredCache();
        cache.prune(1, 1);
        for (let epoch = 1; epoch <= totalEpochs; epoch++) {
          await persistEpoch(cache, datastore, epoch, rootHexForEpoch(epoch));
        }

        // each tier holds at most CP_STATE_TIER_BASE epoch keys, so total persisted << totalEpochs
        for (const tierEpochs of dumpTiers(cache)) {
          expect(tierEpochs.length).toBeLessThanOrEqual(CP_STATE_TIER_BASE);
        }
        expect(fileApisBuffer.size).toBeLessThanOrEqual(CP_STATE_TIER_BASE * dumpTiers(cache).length);
        expect(fileApisBuffer.size).toBeLessThan(totalEpochs);
      });
    });

    describe("retention modes", () => {
      it("flat finite retention mode (maxCPStateEpochsOnDisk) keeps tiers empty and applies legacy flat-window pruning", () => {
        const flat = createTieredCache({maxCPStateEpochsOnDisk: 1});
        expect(dumpTiers(flat.cache)).toEqual([[]]);
        expect((flat.cache as any).isTieredMode).toBe(false);

        flat.cache.add(cp0a, states["cp0a"]);
        flat.cache.add(cp1, states["cp1"]);
        // maxTrackedEpochs = maxCPStateEpochsOnDisk(1) + maxCPStateEpochsInMemory(0) = 1
        expect(flat.cache.get(cp0aHex)).toBeNull();
        flat.cache.add(cp2, states["cp2"]);
        expect(flat.cache.get(cp1Hex)).toBeNull();
        expect(dumpTiers(flat.cache)).toEqual([[]]);
      });

      it("constructor rejects only a negative maxCPStateEpochsOnDisk; any finite >= 0 is a valid legacy flat window", () => {
        const build = (maxCPStateEpochsOnDisk: number): PersistentCheckpointStateCache =>
          new PersistentCheckpointStateCache(
            {
              config,
              datastore: getTestDatastore(new Map()),
              logger: testLogger(),
              blockStateCache: new FIFOBlockStateCache({}, {}),
            },
            {maxCPStateEpochsInMemory: 0, maxCPStateEpochsOnDisk}
          );

        expect(() => build(-1)).toThrow();
        // any finite value >= 0 selects the legacy flat retention (no upper bound); Infinity is tiered
        expect(() => build(0)).not.toThrow();
        expect(() => build(CP_STATE_TIER_BASE + 1)).not.toThrow();
        expect(() => build(100)).not.toThrow();
        expect(() => build(Infinity)).not.toThrow();
      });
    });

    describe("clear()", () => {
      it("empties fileApisBuffer and resets tiers, leaving no orphaned files", async () => {
        const {cache, datastore, fileApisBuffer} = createTieredCache();
        cache.prune(0, 0);
        for (let epoch = 1; epoch <= 5; epoch++) {
          await persistEpoch(cache, datastore, epoch, rootHexForEpoch(epoch));
        }
        expect(fileApisBuffer.size).toBeGreaterThan(0);

        cache.clear();

        expect(fileApisBuffer.size).toBe(0);
        expect(dumpTiers(cache)).toEqual([[]]);
      });
    });
  });

  // clone the epoch-22 state and set its finalized checkpoint so processState() drives the prune
  function stateWithFinalizedEpoch(finalizedEpoch: number): BeaconStateView {
    const cachedState = states["cp2"].cachedState.clone();
    cachedState.slot = 22 * SLOTS_PER_EPOCH + 3;
    cachedState.finalizedCheckpoint = ssz.phase0.Checkpoint.toViewDU({epoch: finalizedEpoch, root: root2});
    cachedState.commit();
    return new BeaconStateView(cachedState);
  }

  async function assertPersistedCheckpointState(cps: phase0.Checkpoint[], stateBytesArr: Uint8Array[]): Promise<void> {
    const persistedKeys = cps.map((cp) => toHexString(checkpointToDatastoreKey(cp)));
    expect(Array.from(fileApisBuffer.keys())).toStrictEqual(persistedKeys);
    for (const [i, persistedKey] of persistedKeys.entries()) {
      expect(fileApisBuffer.get(persistedKey)).toStrictEqual(stateBytesArr[i]);
    }
    for (const [i, cp] of cps.entries()) {
      const cpHex = toCheckpointHex(cp);
      expect(await cache.getStateOrBytes(cpHex)).toStrictEqual(stateBytesArr[i]);
      // simple get() does not reload from disk
      expect(cache.get(cpHex)).toBeNull();
    }
  }
});
