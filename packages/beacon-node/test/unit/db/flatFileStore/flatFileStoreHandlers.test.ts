import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {BLOB_SIDECAR_FIXED_SIZE} from "@lodestar/params";
import type {IBeaconChain} from "../../../../src/chain/interface.js";
import {FlatFileStore} from "../../../../src/db/flatFileStore/flatFileStore.js";
import type {IBeaconDb} from "../../../../src/db/interface.js";
import {BLOB_SIDECARS_IN_WRAPPER_INDEX} from "../../../../src/db/repositories/blobSidecars.js";
import {onBlobSidecarsByRange} from "../../../../src/network/reqresp/handlers/blobSidecarsByRange.js";
import {onDataColumnSidecarsByRange} from "../../../../src/network/reqresp/handlers/dataColumnSidecarsByRange.js";

const testLogger = {
  info: () => {},
  debug: () => {},
  verbose: () => {},
  warn: () => {},
  error: () => {},
} as const;

const ROOT_A = "0x" + "aa".repeat(32);
const ROOT_B = "0x" + "bb".repeat(32);

/** Build a fake BlobSidecarsWrapper binary with N blobs of BLOB_SIDECAR_FIXED_SIZE each. */
function buildBlobWrapper(numBlobs: number, fillByte: number): Uint8Array {
  // 44 bytes of wrapper prefix (blockRoot=32 + slot=8 + offset=4) + N * BLOB_SIDECAR_FIXED_SIZE
  const wrapperSize = BLOB_SIDECARS_IN_WRAPPER_INDEX + numBlobs * BLOB_SIDECAR_FIXED_SIZE;
  const buf = new Uint8Array(wrapperSize);
  // Fill the blob data area so we can verify it's returned
  for (let i = 0; i < numBlobs; i++) {
    const start = BLOB_SIDECARS_IN_WRAPPER_INDEX + i * BLOB_SIDECAR_FIXED_SIZE;
    buf.fill(fillByte + i, start, start + BLOB_SIDECAR_FIXED_SIZE);
  }
  return buf;
}

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
    store = new FlatFileStore(tmpDir, testLogger);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await fs.promises.rm(tmpDir, {recursive: true, force: true});
  });

  describe("onBlobSidecarsByRange with flatFileStore", () => {
    function makeMockChainAndDb(opts: {finalizedSlot: number; headChain?: {slot: number; blockRoot: string}[]}) {
      const chain = {
        config: defaultConfig,
        forkChoice: {
          getFinalizedBlock: () => ({slot: opts.finalizedSlot}),
          getHead: () => ({blockRoot: ROOT_A, payloadStatus: "FULL"}),
          getAllAncestorBlocks: () => opts.headChain ?? [],
        },
      } as unknown as IBeaconChain;

      const db = {
        flatFileStore: store,
        blobSidecars: {},
        blobSidecarsArchive: {},
      } as unknown as IBeaconDb;

      return {chain, db};
    }

    it("should serve finalized blobs from flat file store", async () => {
      // Put a blob wrapper with 2 blobs at slot 100
      const wrapper = buildBlobWrapper(2, 0x10);
      await store.putBlobSidecars(100, ROOT_A, wrapper);

      const {chain, db} = makeMockChainAndDb({finalizedSlot: 200});
      const responses = await collectAsync(onBlobSidecarsByRange({startSlot: 100, count: 1}, chain, db));

      // Should yield 2 individual blob sidecars
      expect(responses.length).toBe(2);
      expect(responses[0].data.length).toBe(BLOB_SIDECAR_FIXED_SIZE);
      expect(responses[1].data.length).toBe(BLOB_SIDECAR_FIXED_SIZE);
      // Verify data content
      expect(responses[0].data[0]).toBe(0x10);
      expect(responses[1].data[0]).toBe(0x11);
    });

    it("should serve multiple finalized slots from flat file store", async () => {
      await store.putBlobSidecars(100, ROOT_A, buildBlobWrapper(1, 0x20));
      await store.putBlobSidecars(101, ROOT_B, buildBlobWrapper(1, 0x30));

      const {chain, db} = makeMockChainAndDb({finalizedSlot: 200});
      const responses = await collectAsync(onBlobSidecarsByRange({startSlot: 100, count: 2}, chain, db));

      expect(responses.length).toBe(2);
      expect(responses[0].data[0]).toBe(0x20);
      expect(responses[1].data[0]).toBe(0x30);
    });

    it("should serve unfinalized blobs from flat file store", async () => {
      // Put a blob at slot 300 (unfinalized, finalized is at 200)
      const wrapper = buildBlobWrapper(1, 0x40);
      await store.putBlobSidecars(300, ROOT_A, wrapper);

      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 200,
        headChain: [{slot: 300, blockRoot: ROOT_A}],
      });
      const responses = await collectAsync(onBlobSidecarsByRange({startSlot: 300, count: 1}, chain, db));

      expect(responses.length).toBe(1);
      expect(responses[0].data[0]).toBe(0x40);
    });

    it("should not duplicate boundary slot between finalized and unfinalized paths", async () => {
      await store.putBlobSidecars(100, ROOT_A, buildBlobWrapper(1, 0x41));
      await store.putBlobSidecars(101, ROOT_B, buildBlobWrapper(1, 0x42));

      const {chain, db} = makeMockChainAndDb({
        finalizedSlot: 100,
        headChain: [{slot: 101, blockRoot: ROOT_B}],
      });

      const responses = await collectAsync(onBlobSidecarsByRange({startSlot: 100, count: 2}, chain, db));
      expect(responses.length).toBe(2);
      expect(responses[0].data[0]).toBe(0x41);
      expect(responses[1].data[0]).toBe(0x42);
    });

    it("should return empty for slot range with no blobs", async () => {
      const {chain, db} = makeMockChainAndDb({finalizedSlot: 200});
      const responses = await collectAsync(onBlobSidecarsByRange({startSlot: 100, count: 1}, chain, db));
      expect(responses.length).toBe(0);
    });

    it("should resolve root from existence cache without readdir", async () => {
      // Put blobs — this populates the existence cache
      await store.putBlobSidecars(100, ROOT_A, buildBlobWrapper(1, 0x70));

      const {chain, db} = makeMockChainAndDb({finalizedSlot: 200});
      const responses = await collectAsync(onBlobSidecarsByRange({startSlot: 100, count: 1}, chain, db));

      expect(responses.length).toBe(1);
      expect(responses[0].data[0]).toBe(0x70);
    });
  });

  describe("onDataColumnSidecarsByRange with flatFileStore", () => {
    // Use a config with fulu enabled at epoch 0 to avoid fork-related filtering
    const fuluConfig = createChainForkConfig({
      ...defaultConfig,
      FULU_FORK_EPOCH: 0,
    });

    function makeMockChainAndDb(opts: {
      finalizedSlot: number;
      custodyColumns: number[];
      earliestAvailableSlot?: number;
      headChain?: {slot: number; blockRoot: string}[];
      getSerializedDataColumnSidecars?: (
        slot: number,
        root: string,
        indices: number[]
      ) => Promise<(Uint8Array | undefined)[]>;
    }) {
      const chain = {
        config: fuluConfig,
        forkChoice: {
          getFinalizedBlock: () => ({slot: opts.finalizedSlot}),
          getHead: () => ({blockRoot: ROOT_A, payloadStatus: "FULL"}),
          getAllAncestorBlocks: () => opts.headChain ?? [],
        },
        custodyConfig: {
          custodyColumns: opts.custodyColumns,
        },
        earliestAvailableSlot: opts.earliestAvailableSlot ?? 0,
        logger: testLogger,
        metrics: null,
        getSerializedDataColumnSidecars: opts.getSerializedDataColumnSidecars ?? vi.fn().mockResolvedValue([]),
      } as unknown as IBeaconChain;

      const db = {
        flatFileStore: store,
        dataColumnSidecarArchive: {},
        block: {getBinary: vi.fn().mockResolvedValue(null)},
        blockArchive: {getBinary: vi.fn().mockResolvedValue(null)},
      } as unknown as IBeaconDb;

      return {chain, db};
    }

    // Minimal mock peerId
    const mockPeerId = {toString: () => "mock-peer"} as any;

    it("should serve finalized columns from flat file store", async () => {
      const col0Data = new Uint8Array(100).fill(0x01);
      const col5Data = new Uint8Array(100).fill(0x05);
      await store.putDataColumnsBinary(10, ROOT_A, [
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

    it("should serve only requested columns from flat file store", async () => {
      await store.putDataColumnsBinary(10, ROOT_A, [
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
      await store.putDataColumnsBinary(10, ROOT_A, [{index: 3, data: new Uint8Array(60).fill(0x10)}]);
      await store.putDataColumnsBinary(11, ROOT_B, [{index: 3, data: new Uint8Array(60).fill(0x11)}]);

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
          .mockImplementation(async (slot: number) => (slot === 11 ? [unfinalizedData] : [undefined])),
      });

      const responses = await collectAsync(
        onDataColumnSidecarsByRange({startSlot: 10, count: 2, columns: [7]}, chain, db, mockPeerId, "test-client")
      );

      expect(responses.length).toBe(2);
      expect(new Uint8Array(responses[0].data)).toEqual(finalizedData);
      expect(new Uint8Array(responses[1].data)).toEqual(unfinalizedData);
    });

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

    it("should not serve columns for non-custody indices", async () => {
      await store.putDataColumnsBinary(10, ROOT_A, [
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
  });
});
