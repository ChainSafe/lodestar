import {expect} from "chai";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Epoch} from "@lodestar/types";
import {
  CheckpointHex,
  CheckpointStateCache,
  PersistentApis,
  StateFile,
  findClosestCheckpointState,
  toCheckpointHex,
  toCheckpointKey,
  toTmpFilePath,
} from "../../../../src/chain/stateCache/stateContextCheckpointsCache.js";
import {generateCachedState} from "../../../utils/state.js";
import {ShufflingCache} from "../../../../src/chain/shufflingCache.js";
import {testLogger} from "../../../utils/logger.js";

describe("CheckpointStateCache", function () {
  let cache: CheckpointStateCache;
  let fileApisBuffer: Map<string, Uint8Array>;
  const cp0 = {epoch: 20, root: Buffer.alloc(32)};
  const cp1 = {epoch: 21, root: Buffer.alloc(32, 1)};
  const cp2 = {epoch: 22, root: Buffer.alloc(32, 2)};
  const [cp0Hex, cp1Hex, cp2Hex] = [cp0, cp1, cp2].map((cp) => toCheckpointHex(cp));
  const [cp0Key, cp1Key, cp2Key] = [cp0Hex, cp1Hex, cp2Hex].map((cp) => toCheckpointKey(cp));
  const states = [cp0, cp1, cp2].map((cp) => generateCachedState({slot: cp.epoch * SLOTS_PER_EPOCH}));
  const stateBytes = states.map((state) => state.serialize());

  beforeEach(() => {
    fileApisBuffer = new Map();
    const persistentApis: PersistentApis = {
      writeIfNotExist: (filePath, bytes) => {
        if (!fileApisBuffer.has(filePath)) {
          fileApisBuffer.set(filePath, bytes);
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      },
      removeFile: (filePath) => {
        if (fileApisBuffer.has(filePath)) {
          fileApisBuffer.delete(filePath);
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      },
      readFile: (filePath) => Promise.resolve(fileApisBuffer.get(filePath) || Buffer.alloc(0)),
      ensureDir: () => Promise.resolve(),
    };
    cache = new CheckpointStateCache(
      {persistentApis, logger: testLogger(), shufflingCache: new ShufflingCache()},
      {maxEpochsInMemory: 2}
    );
    cache.add(cp0, states[0]);
    cache.add(cp1, states[1]);
  });

  it("getLatest", () => {
    // cp0
    expect(cache.getLatest(cp0Hex.rootHex, cp0.epoch)?.hashTreeRoot()).to.be.deep.equal(states[0].hashTreeRoot());
    expect(cache.getLatest(cp0Hex.rootHex, cp0.epoch + 1)?.hashTreeRoot()).to.be.deep.equal(states[0].hashTreeRoot());
    expect(cache.getLatest(cp0Hex.rootHex, cp0.epoch - 1)?.hashTreeRoot()).to.be.undefined;

    // cp1
    expect(cache.getLatest(cp1Hex.rootHex, cp1.epoch)?.hashTreeRoot()).to.be.deep.equal(states[1].hashTreeRoot());
    expect(cache.getLatest(cp1Hex.rootHex, cp1.epoch + 1)?.hashTreeRoot()).to.be.deep.equal(states[1].hashTreeRoot());
    expect(cache.getLatest(cp1Hex.rootHex, cp1.epoch - 1)?.hashTreeRoot()).to.be.undefined;

    // cp2
    expect(cache.getLatest(cp2Hex.rootHex, cp2.epoch)?.hashTreeRoot()).to.be.undefined;
  });

  it("getOrReloadLatest", async () => {
    cache.add(cp2, states[2]);
    expect(cache.pruneFromMemory()).to.be.equal(1);
    // cp0 is persisted
    expect(fileApisBuffer.size).to.be.equal(1);
    expect(Array.from(fileApisBuffer.keys())).to.be.deep.equal([toTmpFilePath(cp0Key)]);

    // getLatest() does not reload from disk
    expect(cache.getLatest(cp0Hex.rootHex, cp0.epoch)?.hashTreeRoot()).to.be.undefined;

    // but getOrReloadLatest() does
    expect((await cache.getOrReloadLatest(cp0Hex.rootHex, cp0.epoch))?.serialize()).to.be.deep.equal(stateBytes[0]);
    expect((await cache.getOrReloadLatest(cp0Hex.rootHex, cp0.epoch + 1))?.serialize()).to.be.deep.equal(stateBytes[0]);
    expect((await cache.getOrReloadLatest(cp0Hex.rootHex, cp0.epoch - 1))?.serialize()).to.be.undefined;
  });

  const pruneTestCases: {
    name: string;
    cpHexGet: CheckpointHex;
    cpKeyPersisted: string;
    stateBytesPersisted: Uint8Array;
  }[] = [
    {
      name: "pruneFromMemory: should prune cp0 from memory and persist to disk",
      cpHexGet: cp1Hex,
      cpKeyPersisted: toTmpFilePath(cp0Key),
      stateBytesPersisted: stateBytes[0],
    },
    {
      name: "pruneFromMemory: should prune cp1 from memory and persist to disk",
      cpHexGet: cp0Hex,
      cpKeyPersisted: toTmpFilePath(cp1Key),
      stateBytesPersisted: stateBytes[1],
    },
  ];

  for (const {name, cpHexGet, cpKeyPersisted, stateBytesPersisted} of pruneTestCases) {
    it(name, function () {
      expect(fileApisBuffer.size).to.be.equal(0);
      // use cpHexGet to move it to head,
      cache.get(cpHexGet);
      cache.add(cp2, states[2]);
      cache.pruneFromMemory();
      expect(cache.get(cp2Hex)?.hashTreeRoot()).to.be.deep.equal(states[2].hashTreeRoot());
      expect(fileApisBuffer.size).to.be.equal(1);
      expect(Array.from(fileApisBuffer.keys())).to.be.deep.equal([cpKeyPersisted]);
      expect(fileApisBuffer.get(cpKeyPersisted)).to.be.deep.equal(stateBytesPersisted);
    });
  }

  const reloadTestCases: {
    name: string;
    cpHexGet: CheckpointHex;
    cpKeyPersisted: CheckpointHex;
    stateBytesPersisted: Uint8Array;
    cpKeyPersisted2: CheckpointHex;
    stateBytesPersisted2: Uint8Array;
  }[] = [
    {
      name: "getOrReload cp0 from disk",
      cpHexGet: cp1Hex,
      cpKeyPersisted: cp0Hex,
      stateBytesPersisted: stateBytes[0],
      cpKeyPersisted2: cp1Hex,
      stateBytesPersisted2: stateBytes[1],
    },
    {
      name: "getOrReload cp1 from disk",
      cpHexGet: cp0Hex,
      cpKeyPersisted: cp1Hex,
      stateBytesPersisted: stateBytes[1],
      cpKeyPersisted2: cp0Hex,
      stateBytesPersisted2: stateBytes[0],
    },
  ];

  for (const {
    name,
    cpHexGet,
    cpKeyPersisted,
    stateBytesPersisted,
    cpKeyPersisted2,
    stateBytesPersisted2,
  } of reloadTestCases) {
    it(name, async function () {
      expect(fileApisBuffer.size).to.be.equal(0);
      // use cpHexGet to move it to head,
      cache.get(cpHexGet);
      cache.add(cp2, states[2]);
      expect(cache.pruneFromMemory()).to.be.equal(1);
      expect(cache.get(cp2Hex)?.hashTreeRoot()).to.be.deep.equal(states[2].hashTreeRoot());
      expect(fileApisBuffer.size).to.be.equal(1);
      const persistedKey0 = toTmpFilePath(toCheckpointKey(cpKeyPersisted));
      expect(Array.from(fileApisBuffer.keys())).to.be.deep.equal([persistedKey0], "incorrect persisted keys");
      expect(fileApisBuffer.get(persistedKey0)).to.be.deep.equal(stateBytesPersisted);
      expect(await cache.getStateOrBytes(cpKeyPersisted)).to.be.deep.equal(stateBytesPersisted);
      // simple get() does not reload from disk
      expect(cache.get(cpKeyPersisted)).to.be.null;
      // reload cpKeyPersisted from disk
      expect((await cache.getOrReload(cpKeyPersisted))?.serialize()).to.be.deep.equal(stateBytesPersisted);
      expect(cache.pruneFromMemory()).to.be.equal(1);
      // check the 2nd persisted checkpoint
      const persistedKey2 = toTmpFilePath(toCheckpointKey(cpKeyPersisted2));
      expect(Array.from(fileApisBuffer.keys())).to.be.deep.equal([persistedKey2], "incorrect persisted keys");
      expect(fileApisBuffer.get(persistedKey2)).to.be.deep.equal(stateBytesPersisted2);
      expect(await cache.getStateOrBytes(cpKeyPersisted2)).to.be.deep.equal(stateBytesPersisted2);
    });
  }

  it("pruneFinalized", function () {
    cache.add(cp1, states[1]);
    cache.add(cp2, states[2]);
    cache.pruneFromMemory();
    // cp0 is persisted
    expect(fileApisBuffer.size).to.be.equal(1);
    expect(Array.from(fileApisBuffer.keys())).to.be.deep.equal([toTmpFilePath(cp0Key)]);
    // cp1 is in memory
    expect(cache.get(cp1Hex)).to.be.not.null;
    // cp2 is in memory
    expect(cache.get(cp2Hex)).to.be.not.null;
    // finalize epoch cp2
    cache.pruneFinalized(cp2.epoch);
    expect(fileApisBuffer.size).to.be.equal(0);
    expect(cache.get(cp1Hex)).to.be.null;
    expect(cache.get(cp2Hex)).to.be.not.null;
    // suspended
    cache.pruneFromMemory();
  });

  /**
   * This is to reproduce the issue that pruneFromMemory() takes forever
   */
  it("pruneFinalized 2", function () {
    cache.add(cp0, states[0]);
    cache.add(cp1, states[1]);
    cache.add(cp2, states[2]);
    expect(fileApisBuffer.size).to.be.equal(0);
    // finalize epoch cp2
    cache.pruneFinalized(cp2.epoch);
    expect(fileApisBuffer.size).to.be.equal(0);
    expect(cache.get(cp0Hex)).to.be.null;
    expect(cache.get(cp1Hex)).to.be.null;
    expect(cache.get(cp2Hex)).to.be.not.null;
    cache.pruneFromMemory();
  });

  describe("findClosestCheckpointState", function () {
    const cacheMap = new Map<string, CachedBeaconStateAllForks | StateFile>();
    cacheMap.set(cp0Key, states[0]);
    cacheMap.set(cp1Key, states[1]);
    cacheMap.set(cp2Key, states[2]);
    const testCases: {name: string; epoch: Epoch; expectedState: CachedBeaconStateAllForks}[] = [
      {
        name: "should return cp0 for epoch less than cp0",
        epoch: 19,
        expectedState: states[0],
      },
      {
        name: "should return cp0 for epoch same to cp0",
        epoch: 20,
        expectedState: states[0],
      },
      {
        name: "should return cp1 for epoch same to cp1",
        epoch: 21,
        expectedState: states[1],
      },
      {
        name: "should return cp2 for epoch same to cp2",
        epoch: 22,
        expectedState: states[2],
      },
      {
        name: "should return cp2 for epoch greater than cp2",
        epoch: 23,
        expectedState: states[2],
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
