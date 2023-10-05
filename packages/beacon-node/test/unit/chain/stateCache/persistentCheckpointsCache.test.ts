import {expect} from "chai";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {CachedBeaconStateAllForks, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, phase0} from "@lodestar/types";
import {mapValues} from "@lodestar/utils";
import {
  PersistentCheckpointStateCache,
  findClosestCheckpointState,
  toCheckpointHex,
  toCheckpointKey,
} from "../../../../src/chain/stateCache/persistentCheckpointsCache.js";
import {generateCachedState} from "../../../utils/state.js";
import {ShufflingCache} from "../../../../src/chain/shufflingCache.js";
import {testLogger} from "../../../utils/logger.js";
import {CheckpointHex, StateFile} from "../../../../src/chain/stateCache/types.js";
import {getTestPersistentApi} from "../../../utils/persistent.js";

describe("PersistentCheckpointStateCache", function () {
  let cache: PersistentCheckpointStateCache;
  let fileApisBuffer: Map<string, Uint8Array>;
  const root0a = Buffer.alloc(32);
  const root0b = Buffer.alloc(32);
  root0b[31] = 1;
  // root0a is of the last slot of epoch 19
  const cp0a = {epoch: 20, root: root0a};
  // root0b is of the first slot of epoch 20
  const cp0b = {epoch: 20, root: root0b};
  const cp1 = {epoch: 21, root: Buffer.alloc(32, 1)};
  const cp2 = {epoch: 22, root: Buffer.alloc(32, 2)};
  const [cp0aHex, cp0bHex, cp1Hex, cp2Hex] = [cp0a, cp0b, cp1, cp2].map((cp) => toCheckpointHex(cp));
  const [cp0aKey, cp0bKey, cp1Key, cp2Key] = [cp0aHex, cp0bHex, cp1Hex, cp2Hex].map((cp) => toCheckpointKey(cp));
  const allStates = [cp0a, cp0b, cp1, cp2]
    .map((cp) => generateCachedState({slot: cp.epoch * SLOTS_PER_EPOCH}))
    .map((state) => {
      const startSlotEpoch20 = computeStartSlotAtEpoch(20);
      state.blockRoots.set((startSlotEpoch20 - 1) % SLOTS_PER_HISTORICAL_ROOT, root0a);
      state.blockRoots.set(startSlotEpoch20 % SLOTS_PER_HISTORICAL_ROOT, root0b);
      return state;
    });

  const states = {
    cp0a: allStates[0],
    cp0b: allStates[1],
    cp1: allStates[2],
    cp2: allStates[3],
  };
  const stateBytes = mapValues(states, (state) => state.serialize());

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
    expect(cache.getLatest(cp0aHex.rootHex, cp0a.epoch)?.hashTreeRoot()).to.be.deep.equal(
      states["cp0a"].hashTreeRoot()
    );
    expect(cache.getLatest(cp0aHex.rootHex, cp0a.epoch + 1)?.hashTreeRoot()).to.be.deep.equal(
      states["cp0a"].hashTreeRoot()
    );
    expect(cache.getLatest(cp0aHex.rootHex, cp0a.epoch - 1)?.hashTreeRoot()).to.be.undefined;

    // cp1
    expect(cache.getLatest(cp1Hex.rootHex, cp1.epoch)?.hashTreeRoot()).to.be.deep.equal(states["cp1"].hashTreeRoot());
    expect(cache.getLatest(cp1Hex.rootHex, cp1.epoch + 1)?.hashTreeRoot()).to.be.deep.equal(
      states["cp1"].hashTreeRoot()
    );
    expect(cache.getLatest(cp1Hex.rootHex, cp1.epoch - 1)?.hashTreeRoot()).to.be.undefined;

    // cp2
    expect(cache.getLatest(cp2Hex.rootHex, cp2.epoch)?.hashTreeRoot()).to.be.undefined;
  });

  it("getOrReloadLatest", async () => {
    cache.add(cp2, states["cp2"]);
    expect(await cache.pruneFromMemory()).to.be.equal(1);
    // cp0b is persisted
    expect(fileApisBuffer.size).to.be.equal(1);
    expect(Array.from(fileApisBuffer.keys())).to.be.deep.equal([cp0bKey]);

    // getLatest() does not reload from disk
    expect(cache.getLatest(cp0aHex.rootHex, cp0a.epoch)).to.be.null;
    expect(cache.getLatest(cp0bHex.rootHex, cp0b.epoch)).to.be.null;

    // cp0a has the root from previous epoch so we only prune it from db
    expect(await cache.getOrReloadLatest(cp0aHex.rootHex, cp0a.epoch)).to.be.null;
    // but getOrReloadLatest() does for cp0b
    expect((await cache.getOrReloadLatest(cp0bHex.rootHex, cp0b.epoch))?.serialize()).to.be.deep.equal(
      stateBytes["cp0b"]
    );
    expect((await cache.getOrReloadLatest(cp0bHex.rootHex, cp0b.epoch + 1))?.serialize()).to.be.deep.equal(
      stateBytes["cp0b"]
    );
    expect((await cache.getOrReloadLatest(cp0bHex.rootHex, cp0b.epoch - 1))?.serialize()).to.be.undefined;
  });

  const pruneTestCases: {
    name: string;
    cpDelete: phase0.Checkpoint | null;
    cpKeyPersisted: string;
    stateBytesPersisted: Uint8Array;
  }[] = [
    /**
     * This replicates the scenario that 1st slot of epoch is NOT skipped
     * - cp0a has the root from previous epoch so we only prune it from db
     * - cp0b has the root of 1st slot of epoch 20 so we prune it from db and persist to disk
     */
    {
      name: "pruneFromMemory: should prune epoch 20 states from memory and persist cp0b to disk",
      cpDelete: null,
      cpKeyPersisted: cp0bKey,
      stateBytesPersisted: stateBytes["cp0b"],
    },
    /**
     * This replicates the scenario that 1st slot of epoch is skipped
     * - cp0a has the root from previous epoch but since 1st slot of epoch 20 is skipped, it's the checkpoint state
     * and we want to prune it from memory and persist to disk
     */
    {
      name: "pruneFromMemory: should prune epoch 20 states from memory and persist cp0a to disk",
      cpDelete: cp0b,
      cpKeyPersisted: cp0aKey,
      stateBytesPersisted: stateBytes["cp0a"],
    },
  ];

  for (const {name, cpDelete, cpKeyPersisted, stateBytesPersisted} of pruneTestCases) {
    it(name, async function () {
      expect(fileApisBuffer.size).to.be.equal(0);
      expect(cache.get(cp0aHex)).to.be.not.null;
      expect(cache.get(cp0bHex)).to.be.not.null;
      if (cpDelete) cache.delete(cpDelete);
      cache.add(cp2, states["cp2"]);
      await cache.pruneFromMemory();
      expect(cache.get(cp0aHex)).to.be.null;
      expect(cache.get(cp0bHex)).to.be.null;
      expect(cache.get(cp1Hex)?.hashTreeRoot()).to.be.deep.equal(states["cp1"].hashTreeRoot());
      expect(cache.get(cp2Hex)?.hashTreeRoot()).to.be.deep.equal(states["cp2"].hashTreeRoot());
      expect(fileApisBuffer.size).to.be.equal(1);
      expect(Array.from(fileApisBuffer.keys())).to.be.deep.equal([cpKeyPersisted]);
      expect(fileApisBuffer.get(cpKeyPersisted)).to.be.deep.equal(stateBytesPersisted);
    });
  }

  const reloadTestCases: {
    name: string;
    cpDelete: phase0.Checkpoint | null;
    cpKeyPersisted: CheckpointHex;
    stateBytesPersisted: Uint8Array;
    cpKeyPersisted2: CheckpointHex;
    stateBytesPersisted2: Uint8Array;
  }[] = [
    // both cp0a and cp0b are from lowest epoch but only cp0b is persisted because it has the root of 1st slot of epoch 20
    {
      name: "getOrReload cp0b from disk",
      cpDelete: null,
      cpKeyPersisted: cp0bHex,
      stateBytesPersisted: stateBytes["cp0b"],
      cpKeyPersisted2: cp1Hex,
      stateBytesPersisted2: stateBytes["cp1"],
    },
    // although cp0a has the root of previous epoch, it's the checkpoint state so we want to reload it from disk
    {
      name: "getOrReload cp0a from disk",
      cpDelete: cp0b,
      cpKeyPersisted: cp0aHex,
      stateBytesPersisted: stateBytes["cp0a"],
      cpKeyPersisted2: cp1Hex,
      stateBytesPersisted2: stateBytes["cp1"],
    },
  ];

  for (const {
    name,
    cpDelete,
    cpKeyPersisted,
    stateBytesPersisted,
    cpKeyPersisted2,
    stateBytesPersisted2,
  } of reloadTestCases) {
    it(name, async function () {
      if (cpDelete) cache.delete(cpDelete);
      expect(fileApisBuffer.size).to.be.equal(0);
      cache.add(cp2, states["cp2"]);
      expect(await cache.pruneFromMemory()).to.be.equal(1);
      expect(cache.get(cp2Hex)?.hashTreeRoot()).to.be.deep.equal(states["cp2"].hashTreeRoot());
      expect(fileApisBuffer.size).to.be.equal(1);
      const persistedKey0 = toCheckpointKey(cpKeyPersisted);
      expect(Array.from(fileApisBuffer.keys())).to.be.deep.equal([persistedKey0], "incorrect persisted keys");
      expect(fileApisBuffer.get(persistedKey0)).to.be.deep.equal(stateBytesPersisted);
      expect(await cache.getStateOrBytes(cpKeyPersisted)).to.be.deep.equal(stateBytesPersisted);
      // simple get() does not reload from disk
      expect(cache.get(cpKeyPersisted)).to.be.null;
      // reload cpKeyPersisted from disk
      expect((await cache.getOrReload(cpKeyPersisted))?.serialize()).to.be.deep.equal(stateBytesPersisted);
      expect(await cache.pruneFromMemory()).to.be.equal(1);
      // check the 2nd persisted checkpoint
      const persistedKey2 = toCheckpointKey(cpKeyPersisted2);
      expect(Array.from(fileApisBuffer.keys())).to.be.deep.equal([persistedKey2], "incorrect persisted keys");
      expect(fileApisBuffer.get(persistedKey2)).to.be.deep.equal(stateBytesPersisted2);
      expect(await cache.getStateOrBytes(cpKeyPersisted2)).to.be.deep.equal(stateBytesPersisted2);
    });
  }

  it("pruneFinalized", async function () {
    cache.add(cp2, states["cp2"]);
    await cache.pruneFromMemory();
    // cp0 is persisted
    expect(fileApisBuffer.size).to.be.equal(1);
    expect(Array.from(fileApisBuffer.keys())).to.be.deep.equal([cp0bKey]);
    // cp1 is in memory
    expect(cache.get(cp1Hex)).to.be.not.null;
    // cp2 is in memory
    expect(cache.get(cp2Hex)).to.be.not.null;
    // finalize epoch cp2
    cache.pruneFinalized(cp2.epoch);
    expect(fileApisBuffer.size).to.be.equal(0);
    expect(cache.get(cp1Hex)).to.be.null;
    expect(cache.get(cp2Hex)).to.be.not.null;
    await cache.pruneFromMemory();
  });

  describe("findClosestCheckpointState", function () {
    const cacheMap = new Map<string, CachedBeaconStateAllForks | StateFile>();
    cacheMap.set(cp0aKey, states["cp0a"]);
    cacheMap.set(cp1Key, states["cp1"]);
    cacheMap.set(cp2Key, states["cp2"]);
    const testCases: {name: string; epoch: Epoch; expectedState: CachedBeaconStateAllForks}[] = [
      {
        name: "should return cp0 for epoch less than cp0",
        epoch: 19,
        expectedState: states["cp0a"],
      },
      {
        name: "should return cp0 for epoch same to cp0",
        epoch: 20,
        expectedState: states["cp0a"],
      },
      {
        name: "should return cp1 for epoch same to cp1",
        epoch: 21,
        expectedState: states["cp1"],
      },
      {
        name: "should return cp2 for epoch same to cp2",
        epoch: 22,
        expectedState: states["cp2"],
      },
      {
        name: "should return cp2 for epoch greater than cp2",
        epoch: 23,
        expectedState: states["cp2"],
      },
    ];

    for (const {name, epoch, expectedState} of testCases) {
      it(name, function () {
        const cpHex = toCheckpointHex({epoch, root: Buffer.alloc(32)});
        const state = findClosestCheckpointState(cpHex, cacheMap);
        expect(state?.hashTreeRoot()).to.be.deep.equal(expectedState.hashTreeRoot());
      });
    }
  });
});
