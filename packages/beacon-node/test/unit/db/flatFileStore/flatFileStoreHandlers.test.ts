import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {PeerId} from "@libp2p/interface";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {type ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {PayloadStatus} from "@lodestar/fork-choice";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {DAType} from "../../../../src/chain/blocks/blockInput/types.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import type {IBeaconChain} from "../../../../src/chain/interface.js";
import {LegacyDataColumnStore} from "../../../../src/db/dataColumnStore.js";
import {FlatFileStore} from "../../../../src/db/flatFileStore/flatFileStore.js";
import type {IFlatFileStore} from "../../../../src/db/flatFileStore/interface.js";
import type {IBeaconDb} from "../../../../src/db/interface.js";
import {onDataColumnSidecarsByRange} from "../../../../src/network/reqresp/handlers/dataColumnSidecarsByRange.js";
import {onDataColumnSidecarsByRoot} from "../../../../src/network/reqresp/handlers/dataColumnSidecarsByRoot.js";
import {handleColumnSidecarUnavailability} from "../../../../src/network/reqresp/utils/dataColumnResponseValidation.js";

const testLogger = {
  info: () => {},
  debug: () => {},
  verbose: () => {},
  warn: () => {},
  error: () => {},
} as const;

const ROOT_A = "0x" + "aa".repeat(32);
const ROOT_B = "0x" + "bb".repeat(32);

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) {
    result.push(item);
  }
  return result;
}

describe("FlatFileStore reqresp handler integration", () => {
  let tmpDir: string;
  let store: FlatFileStore;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lodestar-handlers-"));
    store = new FlatFileStore(path.join(tmpDir, "data_columns"), defaultConfig, testLogger);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await fs.promises.rm(tmpDir, {recursive: true, force: true});
  });

  describe("onDataColumnSidecarsByRange with flatFileStore", () => {
    // Use a config with fulu enabled at epoch 0 to avoid fork-related filtering
    const fuluConfig = createChainForkConfig({
      ...defaultConfig,
      DENEB_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
    });
    const gloasConfig = createChainForkConfig({
      ...defaultConfig,
      DENEB_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    });

    function getArchivedBlock(slot: number) {
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      return block;
    }

    function getArchivedRoot(slot: number): string {
      const block = getArchivedBlock(slot);
      return toRootHex(fuluConfig.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message));
    }

    function makeDataColumnStore(opts: {
      flatFiles?: IFlatFileStore;
      getHot?: (root: Uint8Array, indices: number[]) => Promise<(Uint8Array | undefined)[]>;
      getArchived?: (slot: number, indices: number[]) => Promise<(Uint8Array | undefined)[]>;
      getArchivedSlot?: (root: Uint8Array) => Promise<number | null>;
      hotValues?: () => Promise<ReturnType<typeof ssz.fulu.DataColumnSidecar.defaultValue>[]>;
      archivedValues?: () => Promise<ReturnType<typeof ssz.fulu.DataColumnSidecar.defaultValue>[]>;
    }): LegacyDataColumnStore {
      return new LegacyDataColumnStore(
        opts.flatFiles ?? store,
        {
          getManyBinary: opts.getHot ?? (async (_root, indices) => indices.map(() => undefined)),
          values: opts.hotValues ?? (async () => []),
          deleteMany: vi.fn().mockResolvedValue(undefined),
        },
        {
          getManyBinary: opts.getArchived ?? (async (_slot, indices) => indices.map(() => undefined)),
          values: opts.archivedValues ?? (async () => []),
          keys: vi.fn().mockResolvedValue([]),
          deleteMany: vi.fn().mockResolvedValue(undefined),
        },
        {getSlotByRoot: opts.getArchivedSlot ?? vi.fn().mockResolvedValue(null)}
      );
    }

    function makeMockChainAndDb(opts: {
      config?: ChainForkConfig;
      finalizedSlot: number;
      custodyColumns: number[];
      earliestAvailableSlot?: number;
      headChain?: {slot: number; blockRoot: string; payloadStatus?: PayloadStatus}[];
      forkChoiceBlockByRoot?: {slot: number; blockRoot: string; payloadStatus: PayloadStatus} | null;
      archivedBlockSlotsByRoot?: ReadonlyMap<string, number>;
      getSerializedDataColumnSidecars?: (
        slot: number,
        root: string,
        indices: number[]
      ) => Promise<(Uint8Array | undefined)[]>;
      getHotDataColumnSidecars?: (root: Uint8Array, indices: number[]) => Promise<(Uint8Array | undefined)[]>;
      getArchivedDataColumnSidecars?: (slot: number, indices: number[]) => Promise<(Uint8Array | undefined)[]>;
      hotBlockBytes?: Uint8Array;
      archivedBlockBytes?: Uint8Array;
      hotExecutionPayloadEnvelopeBytes?: Uint8Array;
      archivedExecutionPayloadEnvelopeBytes?: Uint8Array;
      hasCachedPayloadEnvelope?: boolean;
      getCanonicalBlockAtSlot?: IBeaconChain["getCanonicalBlockAtSlot"];
      missingCustodyColumnsInc?: (value: number) => void;
    }) {
      const config = opts.config ?? fuluConfig;
      const custodyColumnsIndex = new Uint8Array(NUMBER_OF_COLUMNS);
      for (const column of opts.custodyColumns) {
        custodyColumnsIndex[column] = 1;
      }

      const archivedSlotsByRoot = new Map(opts.archivedBlockSlotsByRoot);
      const blockArchive = {
        getBinary: vi.fn().mockResolvedValue(opts.archivedBlockBytes ?? null),
        getSlotByRoot: vi.fn(async (root: Uint8Array) => archivedSlotsByRoot.get(toRootHex(root)) ?? null),
      };
      const db = {
        dataColumns: makeDataColumnStore({
          getHot: opts.getHotDataColumnSidecars,
          getArchived: opts.getArchivedDataColumnSidecars,
          getArchivedSlot: blockArchive.getSlotByRoot,
        }),
        block: {getBinary: vi.fn().mockResolvedValue(opts.hotBlockBytes ?? null)},
        blockArchive,
        executionPayloadEnvelope: {
          getBinary: vi.fn().mockResolvedValue(opts.hotExecutionPayloadEnvelopeBytes ?? null),
        },
        executionPayloadEnvelopeArchive: {
          getBinary: vi.fn().mockResolvedValue(opts.archivedExecutionPayloadEnvelopeBytes ?? null),
        },
      } as unknown as IBeaconDb;

      const fallbackChain = {
        config,
        seenBlockInputCache: {get: vi.fn().mockReturnValue(undefined)},
        seenPayloadEnvelopeInputCache: {get: vi.fn().mockReturnValue(undefined)},
        db,
      } as unknown as BeaconChain;

      const chain = {
        config,
        clock: {currentEpoch: 10},
        forkChoice: {
          getFinalizedBlock: () => ({slot: opts.finalizedSlot}),
          getHead: () => ({blockRoot: ROOT_A, payloadStatus: PayloadStatus.FULL}),
          getBlockHexDefaultStatus: vi.fn().mockReturnValue(opts.forkChoiceBlockByRoot ?? null),
          getAllAncestorBlocks: () =>
            (opts.headChain ?? []).map((block) => ({
              ...block,
              payloadStatus: block.payloadStatus ?? PayloadStatus.FULL,
            })),
        },
        custodyConfig: {
          custodyColumns: opts.custodyColumns,
          custodyColumnsIndex,
        },
        earliestAvailableSlot: opts.earliestAvailableSlot ?? 0,
        seenPayloadEnvelopeInputCache: {
          hasPayload: vi.fn().mockReturnValue(opts.hasCachedPayloadEnvelope ?? false),
        },
        logger: testLogger,
        metrics: opts.missingCustodyColumnsInc
          ? {dataColumns: {missingCustodyColumns: {inc: opts.missingCustodyColumnsInc}}}
          : null,
        getCanonicalBlockAtSlot:
          opts.getCanonicalBlockAtSlot ??
          (async (slot: number) => {
            const block = getArchivedBlock(slot);
            archivedSlotsByRoot.set(toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message)), slot);
            return {block, executionOptimistic: false, finalized: true};
          }),
        getSerializedDataColumnSidecars:
          opts.getSerializedDataColumnSidecars ??
          ((slot: number, root: string, indices: number[]) =>
            BeaconChain.prototype.getSerializedDataColumnSidecars.call(fallbackChain, slot, root, indices)),
      } as unknown as IBeaconChain;

      return {chain, db};
    }

    // Minimal mock peerId
    const mockPeerId = {toString: () => "mock-peer"} as unknown as PeerId;

    it("should serve finalized columns from flat file store", async () => {
      const col0Data = new Uint8Array(100).fill(0x01);
      const col5Data = new Uint8Array(100).fill(0x05);
      await store.putDataColumnsBinary(10, getArchivedRoot(10), [
        {index: 0, data: col0Data},
        {index: 5, data: col5Data},
      ]);

      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 100,
        custodyColumns: [0, 5],
      });

      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0, 5]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses.length).toBe(2);
      expect(new Uint8Array(responses[0].data)).toEqual(col0Data);
      expect(new Uint8Array(responses[1].data)).toEqual(col5Data);
    });

    it("should fill finalized flat file misses from the LevelDB archive", async () => {
      const flatFileData = new Uint8Array(32).fill(0x01);
      const archivedData = new Uint8Array(32).fill(0x02);
      await store.putDataColumnsBinary(10, getArchivedRoot(10), [{index: 0, data: flatFileData}]);
      const getArchivedDataColumnSidecars = vi.fn(async (_slot: number, indices: number[]) =>
        indices.map((index) => (index === 1 ? archivedData : undefined))
      );

      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 100,
        custodyColumns: [0, 1],
        getArchivedDataColumnSidecars,
      });
      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0, 1]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses.map(({data}) => new Uint8Array(data))).toEqual([flatFileData, archivedData]);
      expect(getArchivedDataColumnSidecars).toHaveBeenCalledWith(10, [1]);
    });

    it("should fill root-aware flat file misses from hot then archived LevelDB", async () => {
      const flatFileData = new Uint8Array(32).fill(0x11);
      const hotData = new Uint8Array(32).fill(0x22);
      const archivedData = new Uint8Array(32).fill(0x33);
      await store.putDataColumnsBinary(10, ROOT_A, [{index: 0, data: flatFileData}]);

      const getHotDataColumnSidecars = vi.fn(async (_root: Uint8Array, indices: number[]) =>
        indices.map((index) => (index === 1 ? hotData : undefined))
      );
      const getArchivedDataColumnSidecars = vi.fn(async (_slot: number, indices: number[]) =>
        indices.map((index) => (index === 2 ? archivedData : undefined))
      );
      const chain = {
        config: fuluConfig,
        seenBlockInputCache: {get: vi.fn().mockReturnValue(undefined)},
        seenPayloadEnvelopeInputCache: {get: vi.fn().mockReturnValue(undefined)},
        db: {
          dataColumns: makeDataColumnStore({
            getHot: getHotDataColumnSidecars,
            getArchived: getArchivedDataColumnSidecars,
            getArchivedSlot: vi.fn().mockResolvedValue(10),
          }),
        },
      } as unknown as BeaconChain;

      const dataColumnSidecars = await BeaconChain.prototype.getSerializedDataColumnSidecars.call(
        chain,
        10,
        ROOT_A,
        [0, 1, 2]
      );

      expect(dataColumnSidecars).toEqual([flatFileData, hotData, archivedData]);
      expect(getHotDataColumnSidecars).toHaveBeenCalledWith(expect.any(Uint8Array), [1, 2]);
      expect(getArchivedDataColumnSidecars).toHaveBeenCalledWith(10, [2]);
    });

    it("should fill partial cache misses from flat file and LevelDB", async () => {
      const cachedColumn = ssz.fulu.DataColumnSidecar.defaultValue();
      cachedColumn.index = 0;
      const cachedData = ssz.fulu.DataColumnSidecar.serialize(cachedColumn);
      const flatFileData = new Uint8Array(32).fill(0x52);
      const hotData = new Uint8Array(32).fill(0x53);
      await store.putDataColumnsBinary(10, ROOT_A, [{index: 1, data: flatFileData}]);
      const getHotDataColumnSidecars = vi.fn(async (_root: Uint8Array, indices: number[]) =>
        indices.map((index) => (index === 2 ? hotData : undefined))
      );
      const chain = {
        config: fuluConfig,
        seenBlockInputCache: {
          get: vi.fn().mockReturnValue({
            type: DAType.Columns,
            forkName: "fulu",
            getColumn: (index: number) => (index === cachedColumn.index ? cachedColumn : undefined),
          }),
        },
        seenPayloadEnvelopeInputCache: {get: vi.fn().mockReturnValue(undefined)},
        serializedCache: new WeakMap<object, Uint8Array>(),
        db: {
          dataColumns: makeDataColumnStore({getHot: getHotDataColumnSidecars}),
        },
      } as unknown as BeaconChain;

      const dataColumnSidecars = await BeaconChain.prototype.getSerializedDataColumnSidecars.call(
        chain,
        10,
        ROOT_A,
        [0, 1, 2]
      );

      expect(dataColumnSidecars).toEqual([cachedData, flatFileData, hotData]);
      expect(getHotDataColumnSidecars).toHaveBeenCalledWith(expect.any(Uint8Array), [2]);
    });

    it("should not mix slot-keyed archive columns into a non-canonical root", async () => {
      const getArchivedDataColumnSidecars = vi.fn().mockResolvedValue([new Uint8Array(32).fill(0x44)]);
      const chain = {
        config: fuluConfig,
        seenBlockInputCache: {get: vi.fn().mockReturnValue(undefined)},
        seenPayloadEnvelopeInputCache: {get: vi.fn().mockReturnValue(undefined)},
        db: {
          dataColumns: makeDataColumnStore({
            getArchived: getArchivedDataColumnSidecars,
            getArchivedSlot: vi.fn().mockResolvedValue(null),
          }),
        },
      } as unknown as BeaconChain;

      const dataColumnSidecars = await BeaconChain.prototype.getSerializedDataColumnSidecars.call(
        chain,
        10,
        ROOT_A,
        [0]
      );

      expect(dataColumnSidecars).toEqual([undefined]);
      expect(getArchivedDataColumnSidecars).not.toHaveBeenCalled();
    });

    it("should merge deserialized flat file, hot, and archived LevelDB columns by index", async () => {
      const flatColumn = ssz.fulu.DataColumnSidecar.defaultValue();
      flatColumn.index = 0;
      const duplicateHotColumn = ssz.fulu.DataColumnSidecar.defaultValue();
      duplicateHotColumn.index = 0;
      const hotColumn = ssz.fulu.DataColumnSidecar.defaultValue();
      hotColumn.index = 1;
      const duplicateArchivedColumn = ssz.fulu.DataColumnSidecar.defaultValue();
      duplicateArchivedColumn.index = 1;
      const archivedColumn = ssz.fulu.DataColumnSidecar.defaultValue();
      archivedColumn.index = 2;

      const flatFiles = {
        getDataColumns: vi.fn().mockResolvedValue([flatColumn]),
        getDataColumnsBinary: vi.fn(),
        putDataColumnsBinary: vi.fn(),
        deleteMany: vi.fn(),
        pruneBefore: vi.fn(),
        init: vi.fn(),
        close: vi.fn(),
      } satisfies IFlatFileStore;

      const chain = {
        config: fuluConfig,
        seenBlockInputCache: {get: vi.fn().mockReturnValue(undefined)},
        seenPayloadEnvelopeInputCache: {get: vi.fn().mockReturnValue(undefined)},
        db: {
          dataColumns: makeDataColumnStore({
            flatFiles,
            hotValues: vi.fn().mockResolvedValue([duplicateHotColumn, hotColumn]),
            archivedValues: vi.fn().mockResolvedValue([duplicateArchivedColumn, archivedColumn]),
            getArchivedSlot: vi.fn().mockResolvedValue(10),
          }),
        },
      } as unknown as BeaconChain;

      const dataColumnSidecars = await BeaconChain.prototype.getDataColumnSidecars.call(chain, 10, ROOT_A);

      expect(dataColumnSidecars).toEqual([flatColumn, hotColumn, archivedColumn]);
    });

    it("should serve only requested columns from flat file store", async () => {
      await store.putDataColumnsBinary(10, getArchivedRoot(10), [
        {index: 0, data: new Uint8Array(80).fill(0xaa)},
        {index: 1, data: new Uint8Array(80).fill(0xbb)},
        {index: 2, data: new Uint8Array(80).fill(0xcc)},
      ]);

      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 100,
        custodyColumns: [0, 1, 2],
      });

      // Request only column 1
      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [1]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses.length).toBe(1);
      expect(new Uint8Array(responses[0].data)).toEqual(new Uint8Array(80).fill(0xbb));
    });

    it("should serve columns across multiple finalized slots", async () => {
      await store.putDataColumnsBinary(10, getArchivedRoot(10), [{index: 3, data: new Uint8Array(60).fill(0x10)}]);
      await store.putDataColumnsBinary(11, getArchivedRoot(11), [{index: 3, data: new Uint8Array(60).fill(0x11)}]);

      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 100,
        custodyColumns: [3],
      });

      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 2, columns: [3]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses.length).toBe(2);
      expect(new Uint8Array(responses[0].data)).toEqual(new Uint8Array(60).fill(0x10));
      expect(new Uint8Array(responses[1].data)).toEqual(new Uint8Array(60).fill(0x11));
    });

    it("should not duplicate boundary slot between finalized and unfinalized paths", async () => {
      const finalizedData = new Uint8Array(32).fill(0x33);
      const unfinalizedData = new Uint8Array(32).fill(0x44);

      await store.putDataColumnsBinary(10, ROOT_A, [{index: 7, data: finalizedData}]);

      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 10,
        custodyColumns: [7],
        headChain: [{slot: 11, blockRoot: ROOT_B}],
        getSerializedDataColumnSidecars: vi
          .fn()
          .mockImplementation(async (slot: number) => (slot === 10 ? [finalizedData] : [unfinalizedData])),
      });

      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 2, columns: [7]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses.length).toBe(2);
      expect(new Uint8Array(responses[0].data)).toEqual(finalizedData);
      expect(new Uint8Array(responses[1].data)).toEqual(unfinalizedData);
    });

    it("should serve a FULL Gloas block at the finalized boundary from the fork-choice section", async () => {
      const columnData = new Uint8Array(32).fill(0x45);
      const getSerializedDataColumnSidecars = vi.fn().mockResolvedValue([columnData]);
      const {chain, db} = makeMockChainAndDb({
        config: gloasConfig,
        finalizedSlot: 10,
        custodyColumns: [0],
        headChain: [{slot: 10, blockRoot: ROOT_A, payloadStatus: PayloadStatus.FULL}],
        getSerializedDataColumnSidecars,
      });

      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses).toHaveLength(1);
      expect(new Uint8Array(responses[0].data)).toEqual(columnData);
      expect(getSerializedDataColumnSidecars).toHaveBeenCalledWith(10, ROOT_A, [0]);
    });

    for (const {name, payloadStatus} of [
      {name: "PENDING", payloadStatus: PayloadStatus.PENDING},
      {name: "EMPTY", payloadStatus: PayloadStatus.EMPTY},
    ]) {
      it(`should not serve a Gloas ${name} block at the finalized boundary`, async () => {
        const getSerializedDataColumnSidecars = vi.fn().mockResolvedValue([new Uint8Array(32).fill(0x46)]);
        const {chain, db} = makeMockChainAndDb({
          config: gloasConfig,
          finalizedSlot: 10,
          custodyColumns: [0],
          headChain: [{slot: 10, blockRoot: ROOT_A, payloadStatus}],
          getSerializedDataColumnSidecars,
        });

        const responses = await collectAsync(
          onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0]}, chain, db, mockPeerId, "test-client")
        );

        expect(responses).toHaveLength(0);
        expect(getSerializedDataColumnSidecars).not.toHaveBeenCalled();
      });
    }

    it("should handle missing columns gracefully", async () => {
      // No columns stored for slot 10
      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 100,
        custodyColumns: [0],
      });

      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0]}, chain, db, mockPeerId, "test-client")
      );

      // No data should be yielded (column is unavailable)
      expect(responses.length).toBe(0);
    });

    it("should account for missing finalized columns using the archived block", async () => {
      const block = getArchivedBlock(10);
      block.message.body.blobKzgCommitments = [new Uint8Array(48)];
      const missingCustodyColumnsInc = vi.fn();
      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 100,
        custodyColumns: [0],
        archivedBlockBytes: ssz.fulu.SignedBeaconBlock.serialize(block),
        missingCustodyColumnsInc,
      });

      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses).toHaveLength(0);
      expect(db.blockArchive.getBinary).toHaveBeenCalledWith(10);
      expect(db.block.getBinary).not.toHaveBeenCalled();
      expect(missingCustodyColumnsInc).toHaveBeenCalledWith(1);
    });

    it("should account for missing finalized columns using the hot block while archival is pending", async () => {
      const block = getArchivedBlock(10);
      block.message.body.blobKzgCommitments = [new Uint8Array(48)];
      const missingCustodyColumnsInc = vi.fn();
      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 10,
        custodyColumns: [0],
        headChain: [{slot: 10, blockRoot: ROOT_A}],
        hotBlockBytes: ssz.fulu.SignedBeaconBlock.serialize(block),
        missingCustodyColumnsInc,
      });

      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses).toHaveLength(0);
      expect(db.block.getBinary).toHaveBeenCalledWith(fromHex(ROOT_A));
      expect(db.blockArchive.getBinary).not.toHaveBeenCalled();
      expect(missingCustodyColumnsInc).toHaveBeenCalledWith(1);
    });

    it("should account for missing finalized columns after the boundary block is archived", async () => {
      const block = getArchivedBlock(10);
      block.message.body.blobKzgCommitments = [new Uint8Array(48)];
      const missingCustodyColumnsInc = vi.fn();
      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 10,
        custodyColumns: [0],
        headChain: [{slot: 10, blockRoot: ROOT_A}],
        archivedBlockBytes: ssz.fulu.SignedBeaconBlock.serialize(block),
        missingCustodyColumnsInc,
      });

      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses).toHaveLength(0);
      expect(db.block.getBinary).toHaveBeenCalledWith(fromHex(ROOT_A));
      expect(db.blockArchive.getBinary).toHaveBeenCalledWith(10);
      expect(missingCustodyColumnsInc).toHaveBeenCalledWith(1);
    });

    it("should account for missing Gloas boundary columns after the beacon block is archived", async () => {
      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.slot = 10;
      block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments = [new Uint8Array(48)];
      const missingCustodyColumnsInc = vi.fn();
      const {chain, db} = makeMockChainAndDb({
        config: gloasConfig,
        finalizedSlot: 10,
        custodyColumns: [0],
        headChain: [{slot: 10, blockRoot: ROOT_A}],
        getSerializedDataColumnSidecars: vi.fn().mockResolvedValue([undefined]),
        hotExecutionPayloadEnvelopeBytes: new Uint8Array([1]),
        archivedBlockBytes: ssz.gloas.SignedBeaconBlock.serialize(block),
        missingCustodyColumnsInc,
      });

      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses).toHaveLength(0);
      expect(db.executionPayloadEnvelope.getBinary).toHaveBeenCalledWith(fromHex(ROOT_A));
      expect(db.executionPayloadEnvelopeArchive.getBinary).not.toHaveBeenCalled();
      expect(db.block.getBinary).toHaveBeenCalledWith(fromHex(ROOT_A));
      expect(db.blockArchive.getBinary).toHaveBeenCalledWith(10);
      expect(missingCustodyColumnsInc).toHaveBeenCalledWith(1);
    });

    it("should not serve columns for non-custody indices", async () => {
      await store.putDataColumnsBinary(10, getArchivedRoot(10), [
        {index: 0, data: new Uint8Array(50).fill(0x01)},
        {index: 5, data: new Uint8Array(50).fill(0x05)},
      ]);

      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 100,
        custodyColumns: [0], // only custody for column 0
      });

      // Request column 5 which is not in custody
      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [5]}, chain, db, mockPeerId, "test-client")
      );

      // Column 5 is not in custody, so it's filtered out
      expect(responses.length).toBe(0);
    });

    it("should use the canonical root while finalization cleanup is pending", async () => {
      const nonCanonicalData = new Uint8Array(32).fill(0x55);
      const canonicalData = new Uint8Array(32).fill(0x66);
      await store.putDataColumnsBinary(10, ROOT_A, [{index: 0, data: nonCanonicalData}]);
      await store.putDataColumnsBinary(10, ROOT_B, [{index: 0, data: canonicalData}]);

      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 10,
        custodyColumns: [0],
        headChain: [{slot: 10, blockRoot: ROOT_B}],
      });
      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses).toHaveLength(1);
      expect(new Uint8Array(responses[0].data)).toEqual(canonicalData);
    });

    it("should ignore a stale flat file root outside the fork-choice window", async () => {
      const staleData = new Uint8Array(32).fill(0x67);
      const canonicalData = new Uint8Array(32).fill(0x68);
      await store.putDataColumnsBinary(10, ROOT_A, [{index: 0, data: staleData}]);
      const getHotDataColumnSidecars = vi.fn(async (_root: Uint8Array, indices: number[]) =>
        indices.map((index) => (index === 0 ? canonicalData : undefined))
      );

      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 100,
        custodyColumns: [0],
        getHotDataColumnSidecars,
      });
      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses).toHaveLength(1);
      expect(new Uint8Array(responses[0].data)).toEqual(canonicalData);
      expect(getHotDataColumnSidecars).toHaveBeenCalledWith(expect.any(Uint8Array), [0]);
    });

    it("should not serve losing-fork columns at a canonically skipped slot", async () => {
      await store.putDataColumnsBinary(10, ROOT_A, [{index: 0, data: new Uint8Array(32).fill(0x77)}]);

      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 10,
        custodyColumns: [0],
        headChain: [
          {slot: 11, blockRoot: ROOT_B},
          {slot: 9, blockRoot: ROOT_A},
        ],
      });
      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses).toHaveLength(0);
    });

    it("should not serve old finalized Gloas columns without an execution payload envelope", async () => {
      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.slot = 10;
      const blockRootHex = toRootHex(gloasConfig.getForkTypes(10).BeaconBlock.hashTreeRoot(block.message));
      await store.putDataColumnsBinary(10, blockRootHex, [{index: 0, data: new Uint8Array(32).fill(0x88)}]);

      const {chain, db} = makeMockChainAndDb({
        config: gloasConfig,
        finalizedSlot: 11,
        custodyColumns: [0],
        headChain: [{slot: 11, blockRoot: ROOT_B, payloadStatus: PayloadStatus.FULL}],
        getCanonicalBlockAtSlot: async () => ({block, executionOptimistic: false, finalized: true}),
      });
      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses).toHaveLength(0);
      expect(db.executionPayloadEnvelope.getBinary).toHaveBeenCalledWith(fromHex(blockRootHex));
      expect(db.executionPayloadEnvelopeArchive.getBinary).toHaveBeenCalledWith(10);
    });

    it("should serve old finalized Gloas columns while the payload envelope is still hot", async () => {
      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.slot = 10;
      const blockRootHex = toRootHex(gloasConfig.getForkTypes(10).BeaconBlock.hashTreeRoot(block.message));
      const columnBytes = new Uint8Array(32).fill(0x89);
      await store.putDataColumnsBinary(10, blockRootHex, [{index: 0, data: columnBytes}]);

      const {chain, db} = makeMockChainAndDb({
        config: gloasConfig,
        finalizedSlot: 11,
        custodyColumns: [0],
        headChain: [{slot: 11, blockRoot: ROOT_B, payloadStatus: PayloadStatus.FULL}],
        hotExecutionPayloadEnvelopeBytes: new Uint8Array([1]),
        getCanonicalBlockAtSlot: async () => ({block, executionOptimistic: false, finalized: true}),
      });
      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 1, columns: [0]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses).toHaveLength(1);
      expect(new Uint8Array(responses[0].data)).toEqual(columnBytes);
      expect(db.executionPayloadEnvelope.getBinary).toHaveBeenCalledWith(fromHex(blockRootHex));
      expect(db.executionPayloadEnvelopeArchive.getBinary).not.toHaveBeenCalled();
    });

    it("should not account for unavailable unfinalized Gloas columns without a payload envelope", async () => {
      const block = getArchivedBlock(10);
      block.message.body.blobKzgCommitments = [new Uint8Array(48)];
      const missingCustodyColumnsInc = vi.fn();
      const {chain, db} = makeMockChainAndDb({
        config: gloasConfig,
        finalizedSlot: 9,
        custodyColumns: [0],
        hotBlockBytes: ssz.fulu.SignedBeaconBlock.serialize(block),
        missingCustodyColumnsInc,
      });

      await handleColumnSidecarUnavailability({
        chain,
        db,
        metrics: chain.metrics,
        unavailableColumnIndices: [0],
        requestedColumns: [0],
        availableColumns: [0],
        blockRoot: fromHex(ROOT_A),
        finalized: false,
        slot: 10,
      });

      expect(db.executionPayloadEnvelope.getBinary).toHaveBeenCalledWith(fromHex(ROOT_A));
      expect(db.executionPayloadEnvelopeArchive.getBinary).not.toHaveBeenCalled();
      expect(db.block.getBinary).not.toHaveBeenCalled();
      expect(missingCustodyColumnsInc).not.toHaveBeenCalled();
    });

    it("should account for unavailable Gloas columns while the payload envelope write is pending", async () => {
      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.slot = 10;
      block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments = [new Uint8Array(48)];
      const missingCustodyColumnsInc = vi.fn();
      const {chain, db} = makeMockChainAndDb({
        config: gloasConfig,
        finalizedSlot: 9,
        custodyColumns: [0],
        hasCachedPayloadEnvelope: true,
        hotBlockBytes: ssz.gloas.SignedBeaconBlock.serialize(block),
        missingCustodyColumnsInc,
      });

      await handleColumnSidecarUnavailability({
        chain,
        db,
        metrics: chain.metrics,
        unavailableColumnIndices: [0],
        requestedColumns: [0],
        availableColumns: [0],
        blockRoot: fromHex(ROOT_A),
        finalized: false,
        slot: 10,
      });

      expect(chain.seenPayloadEnvelopeInputCache.hasPayload).toHaveBeenCalledWith(ROOT_A);
      expect(db.executionPayloadEnvelope.getBinary).not.toHaveBeenCalled();
      expect(db.block.getBinary).toHaveBeenCalledWith(fromHex(ROOT_A));
      expect(missingCustodyColumnsInc).toHaveBeenCalledWith(1);
    });

    it("should account for missing columns by root when a fork-choice-known block is already archived", async () => {
      const block = getArchivedBlock(10);
      block.message.body.blobKzgCommitments = [new Uint8Array(48)];
      const blockRootHex = toRootHex(fuluConfig.getForkTypes(10).BeaconBlock.hashTreeRoot(block.message));
      const blockRoot = fromHex(blockRootHex);
      const missingCustodyColumnsInc = vi.fn();
      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 10,
        custodyColumns: [0],
        forkChoiceBlockByRoot: {slot: 10, blockRoot: blockRootHex, payloadStatus: PayloadStatus.FULL},
        archivedBlockSlotsByRoot: new Map([[blockRootHex, 10]]),
        getSerializedDataColumnSidecars: vi.fn().mockResolvedValue([undefined]),
        archivedBlockBytes: ssz.fulu.SignedBeaconBlock.serialize(block),
        missingCustodyColumnsInc,
      });

      const responses = await collectAsync(
        onDataColumnSidecarsByRoot([{blockRoot, columns: [0]}], chain, db, mockPeerId, "test-client")
      );

      expect(responses).toHaveLength(0);
      expect(db.blockArchive.getSlotByRoot).toHaveBeenCalledWith(blockRoot);
      expect(db.block.getBinary).toHaveBeenCalledWith(blockRoot);
      expect(db.blockArchive.getBinary).toHaveBeenCalledWith(10);
      expect(missingCustodyColumnsInc).toHaveBeenCalledWith(1);
    });

    it("should account for missing columns by root for a block known only to the archive", async () => {
      const block = getArchivedBlock(10);
      block.message.body.blobKzgCommitments = [new Uint8Array(48)];
      const blockRootHex = toRootHex(fuluConfig.getForkTypes(10).BeaconBlock.hashTreeRoot(block.message));
      const blockRoot = fromHex(blockRootHex);
      const missingCustodyColumnsInc = vi.fn();
      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 10,
        custodyColumns: [0],
        archivedBlockSlotsByRoot: new Map([[blockRootHex, 10]]),
        getSerializedDataColumnSidecars: vi.fn().mockResolvedValue([undefined]),
        archivedBlockBytes: ssz.fulu.SignedBeaconBlock.serialize(block),
        missingCustodyColumnsInc,
      });

      const responses = await collectAsync(
        onDataColumnSidecarsByRoot([{blockRoot, columns: [0]}], chain, db, mockPeerId, "test-client")
      );

      expect(responses).toHaveLength(0);
      expect(db.blockArchive.getSlotByRoot).toHaveBeenCalledWith(blockRoot);
      expect(db.block.getBinary).toHaveBeenCalledWith(blockRoot);
      expect(db.blockArchive.getBinary).toHaveBeenCalledWith(10);
      expect(missingCustodyColumnsInc).toHaveBeenCalledWith(1);
    });
  });
});
