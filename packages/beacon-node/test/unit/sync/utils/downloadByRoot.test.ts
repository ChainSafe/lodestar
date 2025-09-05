import {randomBytes} from "node:crypto";
import {BYTES_PER_BLOB, BYTES_PER_COMMITMENT, BYTES_PER_PROOF} from "@crate-crypto/node-eth-kzg";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {deneb, fulu, ssz} from "@lodestar/types";
import {BlobAndProof} from "@lodestar/types/lib/deneb/types.js";
import {prettyBytes} from "@lodestar/utils";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {BlobMeta, MissingColumnMeta} from "../../../../src/chain/blocks/blockInput/types.js";
import {BlobSidecarValidationError} from "../../../../src/chain/errors/blobSidecarError.js";
import {validateBlockBlobSidecars} from "../../../../src/chain/validation/blobSidecar.js";
import {validateBlockDataColumnSidecars} from "../../../../src/chain/validation/dataColumnSidecar.js";
import {IExecutionEngine} from "../../../../src/execution/index.js";
import {INetwork} from "../../../../src/network/index.js";
import {
  DownloadByRootError,
  fetchAndValidateBlobs,
  fetchAndValidateBlock,
  fetchAndValidateColumns,
  fetchBlobsByRoot,
  fetchColumnsByRoot,
  fetchGetBlobsV1AndBuildSidecars,
  fetchGetBlobsV2AndBuildSidecars,
} from "../../../../src/sync/utils/downloadByRoot.js";
import {kzgCommitmentToVersionedHash} from "../../../../src/util/blobs.js";
import {CustodyConfig} from "../../../../src/util/dataColumns.js";
import {kzg} from "../../../../src/util/kzg.js";
import {ROOT_SIZE} from "../../../../src/util/sszBytes.js";
import {
  config,
  generateBlock,
  generateBlockWithBlobSidecars,
  generateBlockWithColumnSidecars,
} from "../../../utils/blocksAndData.js";
import {PeerSyncMeta} from "../../../../src/network/peers/peersData.js";

describe("downloadByRoot.ts", () => {
  const peerIdStr = "1234567890abcdef1234567890abcdef";
  const peerMeta: PeerSyncMeta = {
    peerId: peerIdStr,
    client: "N/A",
    custodyGroups: Array.from({length: NUMBER_OF_COLUMNS}, (_, i) => i),
    earliestAvailableSlot: 0,
  };
  let network: INetwork;
  let executionEngine: IExecutionEngine;

  describe("fetchAndValidateBlock", () => {
    let capellaBlock: ReturnType<typeof generateBlock>;
    beforeAll(() => {
      capellaBlock = generateBlock({forkName: ForkName.capella});
    });
    afterAll(() => {
      vi.resetAllMocks();
    });

    it("should successfully fetch and validate block with matching root", async () => {
      network = {
        sendBeaconBlocksByRoot: vi.fn(() => [{data: capellaBlock.block}]),
      } as unknown as INetwork;

      const response = await fetchAndValidateBlock({
        config,
        network,
        peerIdStr,
        blockRoot: capellaBlock.blockRoot,
      });

      expect(response).toBe(capellaBlock.block);
    });

    it("should throw error when no block is returned from network", async () => {
      network = {
        sendBeaconBlocksByRoot: vi.fn(() => []),
      } as unknown as INetwork;

      await expect(
        fetchAndValidateBlock({
          config,
          network,
          peerIdStr,
          blockRoot: capellaBlock.blockRoot,
        })
      ).rejects.toThrow(DownloadByRootError);
    });

    it("should throw error when block root doesn't match requested root", async () => {
      network = {
        sendBeaconBlocksByRoot: vi.fn(() => [{data: capellaBlock.block}]),
      } as unknown as INetwork;

      const invalidRoot = randomBytes(ROOT_SIZE);

      await expect(
        fetchAndValidateBlock({
          config,
          network,
          peerIdStr,
          blockRoot: invalidRoot,
        })
      ).rejects.toThrow(DownloadByRootError);
    });
  });

  describe("fetchAndValidateBlobs", () => {
    const forkName = ForkName.deneb;
    let denebBlockWithBlobs: ReturnType<typeof generateBlockWithBlobSidecars>;
    let blobsAndProofs: deneb.BlobAndProof[];
    let blobMeta: BlobMeta[];

    beforeEach(() => {
      denebBlockWithBlobs = generateBlockWithBlobSidecars({forkName, count: 6});
      blobsAndProofs = denebBlockWithBlobs.blobSidecars.map(({blob, kzgProof}) => ({blob, proof: kzgProof}));
      blobMeta = denebBlockWithBlobs.versionedHashes.map((versionedHash, index) => ({
        index,
        blockRoot: denebBlockWithBlobs.blockRoot,
        versionedHash,
      }));
    });

    afterEach(() => {
      vi.resetAllMocks();
    });

    it("should successfully fetch blobs from execution engine only", async () => {
      const sendBlobSidecarsByRootMock = vi.fn(() => Promise.resolve([]));
      network = {
        sendBlobSidecarsByRoot: sendBlobSidecarsByRootMock,
      } as unknown as INetwork;

      const getBlobsMock = vi.fn(() => Promise.resolve(blobsAndProofs));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const response = await fetchAndValidateBlobs({
        config,
        network,
        executionEngine,
        forkName,
        peerIdStr,
        blockRoot: denebBlockWithBlobs.blockRoot,
        block: denebBlockWithBlobs.block,
        blobMeta,
      });

      expect(response.map((b) => b.index)).toEqual(denebBlockWithBlobs.blobSidecars.map((b) => b.index));
    });

    it("should successfully fetch blobs from network only", async () => {
      const sendBlobSidecarsByRootMock = vi.fn(() => Promise.resolve(denebBlockWithBlobs.blobSidecars));
      network = {
        sendBlobSidecarsByRoot: sendBlobSidecarsByRootMock,
      } as unknown as INetwork;

      const getBlobsMock = vi.fn(() => Promise.resolve([]));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const response = await fetchAndValidateBlobs({
        config,
        network,
        executionEngine,
        forkName,
        peerIdStr,
        blockRoot: denebBlockWithBlobs.blockRoot,
        block: denebBlockWithBlobs.block,
        blobMeta,
      });

      expect(response).toEqual(denebBlockWithBlobs.blobSidecars);
    });

    it("should fetch remaining blobs from network when execution engine is incomplete", async () => {
      const getBlobsMock = vi.fn(() =>
        Promise.resolve([blobsAndProofs[0], null, blobsAndProofs[2], null, blobsAndProofs[4], null])
      );
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const sendBlobSidecarsByRootMock = vi.fn(() =>
        Promise.resolve([
          denebBlockWithBlobs.blobSidecars[1],
          denebBlockWithBlobs.blobSidecars[3],
          denebBlockWithBlobs.blobSidecars[5],
        ])
      );
      network = {
        sendBlobSidecarsByRoot: sendBlobSidecarsByRootMock,
      } as unknown as INetwork;

      const response = await fetchAndValidateBlobs({
        config,
        network,
        executionEngine,
        forkName,
        peerIdStr,
        blockRoot: denebBlockWithBlobs.blockRoot,
        block: denebBlockWithBlobs.block,
        blobMeta,
      });

      expect(getBlobsMock).toHaveBeenCalledExactlyOnceWith(
        forkName,
        blobMeta.map(({versionedHash}) => versionedHash)
      );
      expect(sendBlobSidecarsByRootMock).toHaveBeenCalledExactlyOnceWith(peerIdStr, [
        {blockRoot: denebBlockWithBlobs.blockRoot, index: 1},
        {blockRoot: denebBlockWithBlobs.blockRoot, index: 3},
        {blockRoot: denebBlockWithBlobs.blockRoot, index: 5},
      ]);

      const returnedIndices = response.map((b) => b.index);
      expect(returnedIndices).toEqual(returnedIndices.sort());
      expect(returnedIndices).toEqual(denebBlockWithBlobs.blobSidecars.map((b) => b.index));
    });

    it("should gracefully handle getBlobsV1 failure", async () => {
      const rejectedError = new Error("TESTING_ERROR");
      const getBlobsMock = vi.fn(() => Promise.reject(rejectedError));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const sendBlobSidecarsByRootMock = vi.fn(() => Promise.resolve(denebBlockWithBlobs.blobSidecars));
      const loggerMock = {
        error: vi.fn(),
      };
      network = {
        logger: loggerMock,
        sendBlobSidecarsByRoot: sendBlobSidecarsByRootMock,
      } as unknown as INetwork;

      const response = await fetchAndValidateBlobs({
        config,
        network,
        executionEngine,
        forkName,
        peerIdStr,
        blockRoot: denebBlockWithBlobs.blockRoot,
        block: denebBlockWithBlobs.block,
        blobMeta,
      });
      expect(getBlobsMock).toHaveBeenCalledExactlyOnceWith(
        forkName,
        blobMeta.map(({versionedHash}) => versionedHash)
      );
      expect(loggerMock.error).toHaveBeenCalledExactlyOnceWith(
        `error fetching/building blobSidecars for blockRoot=${prettyBytes(denebBlockWithBlobs.blockRoot)} via getBlobsV1`,
        {},
        rejectedError
      );
      expect(sendBlobSidecarsByRootMock).toHaveBeenCalledExactlyOnceWith(
        peerIdStr,
        denebBlockWithBlobs.blobSidecars.map((b) => ({
          blockRoot: denebBlockWithBlobs.blockRoot,
          index: b.index,
        }))
      );
      expect(response).toEqual(denebBlockWithBlobs.blobSidecars);
    });

    it("should throw error if blob validation fails", async () => {
      const sendBlobSidecarsByRootMock = vi.fn(() => Promise.resolve([]));
      network = {
        sendBlobSidecarsByRoot: sendBlobSidecarsByRootMock,
      } as unknown as INetwork;

      const getBlobsMock = vi.fn(() => Promise.resolve(blobsAndProofs));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const requestedBlockRoot = randomBytes(ROOT_SIZE);

      await expect(
        fetchAndValidateBlobs({
          config,
          network,
          executionEngine,
          forkName,
          peerIdStr,
          blockRoot: requestedBlockRoot,
          block: denebBlockWithBlobs.block,
          blobMeta,
        })
      ).rejects.toThrow(BlobSidecarValidationError);
    });
  });

  describe("fetchGetBlobsV1AndBuildSidecars", () => {
    let denebBlockWithBlobs: ReturnType<typeof generateBlockWithBlobSidecars>;
    let blobsAndProofs: deneb.BlobAndProof[];
    let blobMeta: BlobMeta[];
    const forkName = ForkName.deneb;

    beforeEach(() => {
      denebBlockWithBlobs = generateBlockWithBlobSidecars({forkName, count: 6});
      blobsAndProofs = denebBlockWithBlobs.blobSidecars.map(({blob, kzgProof}) => ({blob, proof: kzgProof}));
      blobMeta = denebBlockWithBlobs.versionedHashes.map(
        (versionedHash, index) => ({index, versionedHash}) as BlobMeta
      );
    });

    afterEach(() => {
      vi.resetAllMocks();
    });

    it("should call getBlobs with the correct arguments", async () => {
      const getBlobsMock = vi.fn(() => Promise.resolve(blobsAndProofs));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      await fetchGetBlobsV1AndBuildSidecars({
        config,
        forkName,
        executionEngine,
        block: denebBlockWithBlobs.block,
        blobMeta: blobMeta,
      });

      expect(getBlobsMock).toHaveBeenCalledOnce();
      expect(getBlobsMock).toHaveBeenCalledWith(forkName, denebBlockWithBlobs.versionedHashes);
    });

    it("should return empty array when execution engine returns no blobs", async () => {
      const getBlobsMock = vi.fn(() => Promise.resolve([]));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const response = await fetchGetBlobsV1AndBuildSidecars({
        config,
        forkName,
        executionEngine,
        block: denebBlockWithBlobs.block,
        blobMeta: blobMeta,
      });
      expect(response).toEqual([]);
    });

    it("should build valid blob sidecars from execution engine response", async () => {
      const getBlobsMock = vi.fn(() => Promise.resolve(blobsAndProofs));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const response = await fetchGetBlobsV1AndBuildSidecars({
        config,
        forkName,
        executionEngine,
        block: denebBlockWithBlobs.block,
        blobMeta: blobMeta,
      });

      expect(getBlobsMock).toHaveBeenCalledOnce();
      expect(response).toBeDefined();
      expect(response).toBeInstanceOf(Array);
      expect(response.length).toEqual(blobsAndProofs.length);
      for (const blobSidecar of response) {
        blobSidecar.kzgCommitmentInclusionProof;
        expect(blobSidecar).toHaveProperty("index");
        expect(blobSidecar.index).toBeTypeOf("number");

        expect(blobSidecar).toHaveProperty("blob");
        expect(blobSidecar.blob).toBeInstanceOf(Uint8Array);
        expect(blobSidecar.blob.length).toEqual(BYTES_PER_BLOB);

        expect(blobSidecar).toHaveProperty("kzgProof");
        expect(blobSidecar.kzgProof).toBeInstanceOf(Uint8Array);
        expect(blobSidecar.kzgProof.length).toEqual(BYTES_PER_PROOF);

        expect(blobSidecar).toHaveProperty("kzgCommitment");
        expect(blobSidecar.kzgCommitment).toBeInstanceOf(Uint8Array);
        expect(blobSidecar.kzgCommitment.length).toEqual(BYTES_PER_COMMITMENT);

        expect(blobSidecar).toHaveProperty("kzgCommitmentInclusionProof");
        expect(blobSidecar.kzgCommitmentInclusionProof).toBeInstanceOf(Array);
        blobSidecar.kzgCommitmentInclusionProof.map((proof) => expect(proof).toBeInstanceOf(Uint8Array));

        expect(blobSidecar).toHaveProperty("signedBlockHeader");
        expect(blobSidecar.signedBlockHeader.message.slot).toBe(denebBlockWithBlobs.block.message.slot);
        expect(blobSidecar.signedBlockHeader.message.proposerIndex).toBe(
          denebBlockWithBlobs.block.message.proposerIndex
        );
        expect(blobSidecar.signedBlockHeader.message.parentRoot).toEqual(denebBlockWithBlobs.block.message.parentRoot);
        expect(blobSidecar.signedBlockHeader.message.stateRoot).toEqual(denebBlockWithBlobs.block.message.stateRoot);
      }

      await expect(
        validateBlockBlobSidecars(
          denebBlockWithBlobs.block.message.slot,
          denebBlockWithBlobs.blockRoot,
          denebBlockWithBlobs.block.message.body.blobKzgCommitments.length,
          response
        )
      ).resolves.toBeUndefined();
    });

    it("should handle partial blob response from execution engine", async () => {
      const engineResponse: (BlobAndProof | null)[] = [...blobsAndProofs];
      engineResponse[2] = null;
      engineResponse[4] = null;
      const getBlobsMock = vi.fn(() => Promise.resolve(engineResponse));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const response = await fetchGetBlobsV1AndBuildSidecars({
        config,
        forkName,
        executionEngine,
        block: denebBlockWithBlobs.block,
        blobMeta: blobMeta,
      });

      expect(response.length).toEqual(4);
      expect(response.map(({index}) => index)).toEqual([0, 1, 3, 5]);
    });
  });

  describe("fetchBlobsByRoot", () => {
    let denebBlockWithColumns: ReturnType<typeof generateBlockWithBlobSidecars>;
    let blockRoot: Uint8Array;
    let blobMeta: BlobMeta[];
    beforeAll(() => {
      denebBlockWithColumns = generateBlockWithBlobSidecars({forkName: ForkName.deneb, count: 6});
      blockRoot = denebBlockWithColumns.blockRoot;
      blobMeta = denebBlockWithColumns.blobSidecars.map((_, index) => ({blockRoot, index}) as BlobMeta);
      network = {
        sendBlobSidecarsByRoot: vi.fn(() => denebBlockWithColumns.blobSidecars),
      } as unknown as INetwork;
    });
    afterAll(() => {
      vi.resetAllMocks();
    });

    it("should fetch missing columnSidecars ByRoot from network", async () => {
      const response = await fetchBlobsByRoot({
        network,
        peerIdStr,
        blobMeta,
      });
      expect(response).toEqual(denebBlockWithColumns.blobSidecars);
      expect(network.sendBlobSidecarsByRoot).toHaveBeenCalledOnce();
      expect(network.sendBlobSidecarsByRoot).toHaveBeenCalledWith(peerIdStr, blobMeta);
    });

    it("should filter out blobs already in possession", async () => {
      await fetchBlobsByRoot({
        network,
        peerIdStr,
        blobMeta,
        // biome-ignore lint/style/noNonNullAssertion: its there
        indicesInPossession: [0, denebBlockWithColumns.blobSidecars.at(-1)?.index!],
      });
      expect(network.sendBlobSidecarsByRoot).toHaveBeenCalledOnce();
      expect(network.sendBlobSidecarsByRoot).toHaveBeenCalledWith(peerIdStr, blobMeta.slice(1, -1));
    });

    it("should handle empty blob request when all blobs are in possession", async () => {
      const response = await fetchBlobsByRoot({
        network,
        peerIdStr,
        blobMeta,
        indicesInPossession: blobMeta.map(({index}) => index),
      });
      expect(response).toEqual([]);
      expect(network.sendBlobSidecarsByRoot).not.toHaveBeenCalled();
    });
  });

  describe("fetchAndValidateColumns", () => {
    const forkName = ForkName.fulu;
    let fuluBlockWithColumns: ReturnType<typeof generateBlockWithColumnSidecars>;
    let blobAndProofs: fulu.BlobAndProofV2[];
    let columnMeta: MissingColumnMeta;
    let versionedHashes: Uint8Array[];
    let custodyConfig: CustodyConfig;

    beforeEach(() => {
      fuluBlockWithColumns = generateBlockWithColumnSidecars({forkName, returnBlobs: true});
      // biome-ignore lint/style/noNonNullAssertion: returnBlobs = true
      const blobs = fuluBlockWithColumns.blobs!;
      blobAndProofs = blobs
        .map((b) => kzg.computeCellsAndKzgProofs(b))
        .map(({proofs}, i) => ({proofs, blob: blobs[i]}));
      versionedHashes = fuluBlockWithColumns.block.message.body.blobKzgCommitments.map((c) =>
        kzgCommitmentToVersionedHash(c)
      );
      columnMeta = {
        missing: [0, 1, 2, 3, 4, 5, 6, 7], // Sample a subset of columns
        versionedHashes,
      };
      custodyConfig = {
        custodyColumns: [0, 1, 2, 3],
        sampledColumns: [0, 1, 2, 3, 4, 5, 6, 7],
      } as CustodyConfig;
    });

    afterEach(() => {
      vi.resetAllMocks();
    });

    it("should successfully fetch columns from execution engine only", async () => {
      const sendDataColumnSidecarsByRootMock = vi.fn(() => Promise.resolve([]));
      const publishDataColumnSidecarMock = vi.fn(() => Promise.resolve());
      network = {
        sendDataColumnSidecarsByRoot: sendDataColumnSidecarsByRootMock,
        publishDataColumnSidecar: publishDataColumnSidecarMock,
        custodyConfig,
        logger: {
          error: vi.fn(),
        },
      } as unknown as INetwork;

      const getBlobsMock = vi.fn(() => Promise.resolve(blobAndProofs));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const response = await fetchAndValidateColumns({
        config,
        network,
        executionEngine,
        forkName,
        peerMeta,
        blockRoot: fuluBlockWithColumns.blockRoot,
        block: fuluBlockWithColumns.block,
        columnMeta,
      });

      expect(getBlobsMock).toHaveBeenCalledExactlyOnceWith(forkName, versionedHashes);
      expect(sendDataColumnSidecarsByRootMock).not.toHaveBeenCalled();
      // Should only return the columns we need (missing)
      expect(response.map((c) => c.index)).toEqual(columnMeta.missing);
      // Should publish columns we custody that weren't already published
      expect(publishDataColumnSidecarMock).toHaveBeenCalled();
    });

    it("should only publish columns that have not already been published", async () => {
      const publishDataColumnSidecarMock = vi.fn(() => Promise.resolve());
      network = {
        sendDataColumnSidecarsByRoot: vi.fn(() => Promise.resolve([])),
        publishDataColumnSidecar: publishDataColumnSidecarMock,
        custodyConfig,
        logger: {
          error: vi.fn(),
        },
      } as unknown as INetwork;

      const getBlobsMock = vi.fn(() => Promise.resolve(blobAndProofs));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      // Columns 0, 1 are already published (not in missing)
      // Columns 2, 3, 4, 5, 6, 7 are missing sampledColumns and need to be fetched
      // After reconstruction, we should publish columns 2, 3 (we custody them and they weren't published)
      // Column 5, 6, 7 we sample but do not custody so we don't need to publish
      const testColumnMeta = {
        missing: [2, 3, 4, 5, 6, 7],
        versionedHashes,
      };

      await fetchAndValidateColumns({
        config,
        network,
        executionEngine,
        forkName,
        peerMeta,
        blockRoot: fuluBlockWithColumns.blockRoot,
        block: fuluBlockWithColumns.block,
        columnMeta: testColumnMeta,
      });

      // Should publish columns 2, 3, 4 (custody and were missing)
      const publishedIndices = publishDataColumnSidecarMock.mock.calls.map((call) => (call as any)[0]?.index);
      expect(publishedIndices).toEqual([2, 3]);
    });

    it("should only return columns that are needed from reconstruction", async () => {
      network = {
        sendDataColumnSidecarsByRoot: vi.fn(() => Promise.resolve([])),
        publishDataColumnSidecar: vi.fn(() => Promise.resolve()),
        custodyConfig: {
          custodyColumns: [0, 2, 4, 6],
          sampledColumns: [0, 2, 4, 6, 8, 10, 12],
        },
        logger: {
          error: vi.fn(),
        },
      } as unknown as INetwork;

      const getBlobsMock = vi.fn(() => Promise.resolve(blobAndProofs));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const missing = [0, 4, 6, 10, 12];
      const testColumnMeta = {
        missing, // Only need these columns
        versionedHashes,
      };

      const response = await fetchAndValidateColumns({
        config,
        network,
        executionEngine,
        forkName,
        peerMeta,
        blockRoot: fuluBlockWithColumns.blockRoot,
        block: fuluBlockWithColumns.block,
        columnMeta: testColumnMeta,
      });

      // Even though reconstruction produces all columns, we should only return what we need
      expect(response.length).toBe(5);
      expect(response.map((c) => c.index)).toEqual(missing);
    });

    it("should successfully fetch columns from network only", async () => {
      const neededColumns = fuluBlockWithColumns.columnSidecars.filter((c) => columnMeta.missing.includes(c.index));
      const sendDataColumnSidecarsByRootMock = vi.fn(() => Promise.resolve(neededColumns));
      network = {
        sendDataColumnSidecarsByRoot: sendDataColumnSidecarsByRootMock,
        publishDataColumnSidecar: vi.fn(() => Promise.resolve()),
        custodyConfig: {
          custodyColumns: [0, 1, 2, 3, 4, 5],
          sampledColumns: columnMeta.missing,
        },
        logger: {
          error: vi.fn(),
        },
      } as unknown as INetwork;

      const getBlobsMock = vi.fn(() => Promise.resolve(null)); // No blobs from execution engine
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const response = await fetchAndValidateColumns({
        config,
        network,
        executionEngine,
        forkName,
        peerMeta,
        blockRoot: fuluBlockWithColumns.blockRoot,
        block: fuluBlockWithColumns.block,
        columnMeta,
      });

      expect(getBlobsMock).toHaveBeenCalledExactlyOnceWith(forkName, versionedHashes);
      expect(sendDataColumnSidecarsByRootMock).toHaveBeenCalledExactlyOnceWith(peerIdStr, [
        {blockRoot: fuluBlockWithColumns.blockRoot, columns: columnMeta.missing},
      ]);
      expect(response.map((c) => c.index)).toEqual(columnMeta.missing);
    });

    it("should gracefully handle getBlobsV2 failure", async () => {
      const rejectedError = new Error("TESTING_ERROR");
      const getBlobsMock = vi.fn(() => Promise.reject(rejectedError));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const neededColumns = fuluBlockWithColumns.columnSidecars.filter((c) => columnMeta.missing.includes(c.index));
      const sendDataColumnSidecarsByRootMock = vi.fn(() => Promise.resolve(neededColumns));
      const loggerMock = {
        error: vi.fn(),
      };
      network = {
        logger: loggerMock,
        sendDataColumnSidecarsByRoot: sendDataColumnSidecarsByRootMock,
        publishDataColumnSidecar: vi.fn(() => Promise.resolve()),
        custodyConfig: {
          custodyColumns: [0, 1, 2, 3, 4, 5],
          sampledColumns: columnMeta.missing,
        },
      } as unknown as INetwork;

      const response = await fetchAndValidateColumns({
        config,
        network,
        executionEngine,
        forkName,
        peerMeta,
        blockRoot: fuluBlockWithColumns.blockRoot,
        block: fuluBlockWithColumns.block,
        columnMeta,
      });

      expect(getBlobsMock).toHaveBeenCalledExactlyOnceWith(forkName, versionedHashes);
      expect(loggerMock.error).toHaveBeenCalledExactlyOnceWith(
        "error building columnSidecars via getBlobsV2",
        {
          blockRoot: prettyBytes(fuluBlockWithColumns.blockRoot),
          slot: fuluBlockWithColumns.block.message.slot,
        },
        rejectedError
      );
      expect(sendDataColumnSidecarsByRootMock).toHaveBeenCalledExactlyOnceWith(peerIdStr, [
        {blockRoot: fuluBlockWithColumns.blockRoot, columns: columnMeta.missing},
      ]);
      expect(response.map((c) => c.index)).toEqual(columnMeta.missing);
    });

    it("should throw error if column validation fails", async () => {
      // biome-ignore lint/style/noNonNullAssertion: exists
      const invalidColumn = ssz.fulu.DataColumnSidecar.clone(fuluBlockWithColumns.columnSidecars.at(1)!);
      // Corrupt the inclusion proof to make validation fail
      invalidColumn.kzgCommitmentsInclusionProof[0] = new Uint8Array(32).fill(255);

      const sendDataColumnSidecarsByRootMock = vi.fn(() =>
        Promise.resolve([
          fuluBlockWithColumns.columnSidecars[0],
          invalidColumn,
          fuluBlockWithColumns.columnSidecars.slice(2, 6),
        ])
      );
      network = {
        sendDataColumnSidecarsByRoot: sendDataColumnSidecarsByRootMock,
        publishDataColumnSidecar: vi.fn(() => Promise.resolve()),
        custodyConfig: {
          custodyColumns: [0, 1, 2, 3, 4, 5],
          sampledColumns: [0, 1, 2, 3, 4, 5],
        },
        logger: {
          error: vi.fn(),
        },
      } as unknown as INetwork;

      const getBlobsMock = vi.fn(() => Promise.resolve([]));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      await expect(
        fetchAndValidateColumns({
          config,
          network,
          executionEngine,
          forkName,
          peerMeta,
          blockRoot: fuluBlockWithColumns.blockRoot,
          block: fuluBlockWithColumns.block,
          columnMeta: {
            missing: [0, 1, 2, 3, 4, 5],
            versionedHashes,
          },
        })
      ).rejects.toThrow(DownloadByRootError);
    });

    it("should handle error when publishing reconstructed columns", async () => {
      const publishError = new Error("PUBLISH_ERROR");
      const publishDataColumnSidecarMock = vi.fn(() => Promise.reject(publishError));
      const loggerMock = {
        error: vi.fn(),
      };
      network = {
        sendDataColumnSidecarsByRoot: vi.fn(() => Promise.resolve([])),
        publishDataColumnSidecar: publishDataColumnSidecarMock,
        custodyConfig: {
          custodyColumns: [0, 1, 2, 3],
          sampledColumns: [0, 1, 2, 3, 4, 5, 6, 7],
        },
        logger: loggerMock,
      } as unknown as INetwork;

      const getBlobsMock = vi.fn(() => Promise.resolve(blobAndProofs));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const response = await fetchAndValidateColumns({
        config,
        network,
        executionEngine,
        forkName,
        peerMeta,
        blockRoot: fuluBlockWithColumns.blockRoot,
        block: fuluBlockWithColumns.block,
        columnMeta: {
          missing: [0, 1, 2, 3, 4, 5, 6, 7],
          versionedHashes,
        },
      });

      // Should still return the columns even if publishing fails
      expect(response.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

      // Should log the publishing error
      expect(loggerMock.error).toHaveBeenCalledTimes(4);
      expect(loggerMock.error).toHaveBeenNthCalledWith(
        1,
        "Error publishing column after getBlobsV2 reconstruct",
        {
          index: 0,
          blockRoot: prettyBytes(fuluBlockWithColumns.blockRoot),
        },
        publishError
      );
      expect(loggerMock.error).toHaveBeenNthCalledWith(
        2,
        "Error publishing column after getBlobsV2 reconstruct",
        {
          index: 1,
          blockRoot: prettyBytes(fuluBlockWithColumns.blockRoot),
        },
        publishError
      );
      expect(loggerMock.error).toHaveBeenNthCalledWith(
        3,
        "Error publishing column after getBlobsV2 reconstruct",
        {
          index: 2,
          blockRoot: prettyBytes(fuluBlockWithColumns.blockRoot),
        },
        publishError
      );
      expect(loggerMock.error).toHaveBeenNthCalledWith(
        4,
        "Error publishing column after getBlobsV2 reconstruct",
        {
          index: 3,
          blockRoot: prettyBytes(fuluBlockWithColumns.blockRoot),
        },
        publishError
      );
    });
  });

  describe("fetchGetBlobsV2AndBuildSidecars", () => {
    let fuluBlockWithColumns: ReturnType<typeof generateBlockWithColumnSidecars>;
    let blobAndProofs: fulu.BlobAndProofV2[];
    let versionedHashes: Uint8Array[];

    beforeEach(() => {
      fuluBlockWithColumns = generateBlockWithColumnSidecars({forkName: ForkName.fulu, returnBlobs: true});
      // biome-ignore lint/style/noNonNullAssertion: returnBlobs = true
      const blobs = fuluBlockWithColumns.blobs!;
      blobAndProofs = blobs
        .map((b) => kzg.computeCellsAndKzgProofs(b))
        .map(({proofs}, i) => ({proofs, blob: blobs[i]}));
      versionedHashes = fuluBlockWithColumns.block.message.body.blobKzgCommitments.map((c) =>
        kzgCommitmentToVersionedHash(c)
      );
    });

    afterEach(() => {
      vi.resetAllMocks();
    });

    it("should call getBlobs with the correct arguments", async () => {
      const getBlobsMock = vi.fn(() => Promise.resolve(blobAndProofs));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const columnMeta = {
        missing: fuluBlockWithColumns.columnSidecars.map((c) => c.index),
        versionedHashes,
      };

      await fetchGetBlobsV2AndBuildSidecars({
        config,
        executionEngine,
        forkName: ForkName.fulu,
        block: fuluBlockWithColumns.block,
        columnMeta,
      });

      expect(getBlobsMock).toHaveBeenCalledOnce();
      expect(getBlobsMock).toHaveBeenCalledWith(ForkName.fulu, versionedHashes);
    });

    it("should return empty array when execution engine returns no response", async () => {
      const getBlobsMock = vi.fn(() => Promise.resolve(null));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const columnMeta = {
        missing: fuluBlockWithColumns.columnSidecars.map((c) => c.index),
        versionedHashes,
      };

      const result = await fetchGetBlobsV2AndBuildSidecars({
        config,
        executionEngine,
        forkName: ForkName.fulu,
        block: fuluBlockWithColumns.block,
        columnMeta,
      });

      expect(getBlobsMock).toHaveBeenCalledOnce();
      expect(result).toEqual([]);
    });

    it("should build valid columnSidecars from execution engine blobs", async () => {
      const getBlobsMock = vi.fn(() => Promise.resolve(blobAndProofs));
      executionEngine = {
        getBlobs: getBlobsMock,
      } as unknown as IExecutionEngine;

      const columnMeta = {
        missing: fuluBlockWithColumns.columnSidecars.map((c) => c.index),
        versionedHashes,
      };

      const result = await fetchGetBlobsV2AndBuildSidecars({
        config,
        executionEngine,
        forkName: ForkName.fulu,
        block: fuluBlockWithColumns.block,
        columnMeta,
      });

      expect(getBlobsMock).toHaveBeenCalledOnce();
      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toEqual(NUMBER_OF_COLUMNS);

      // Verify the structure of the returned column sidecars
      for (const [_, columnSidecar] of Object.entries(result)) {
        expect(
          validateBlockDataColumnSidecars(
            columnSidecar.signedBlockHeader.message.slot,
            fuluBlockWithColumns.blockRoot,
            fuluBlockWithColumns.block.message.body.blobKzgCommitments.length,
            [columnSidecar]
          )
        ).resolves.toBeUndefined();
      }
    });
  });

  describe("fetchColumnsByRoot", () => {
    let fuluBlockWithColumns: ReturnType<typeof generateBlockWithColumnSidecars>;
    beforeAll(() => {
      fuluBlockWithColumns = generateBlockWithColumnSidecars({forkName: ForkName.fulu});
      network = {
        sendDataColumnSidecarsByRoot: vi.fn(() => fuluBlockWithColumns.columnSidecars),
      } as unknown as INetwork;
    });
    afterAll(() => {
      vi.resetAllMocks();
    });
    it("should fetch missing columnSidecars ByRoot from network", async () => {
      const blockRoot = fuluBlockWithColumns.blockRoot;
      const missing = fuluBlockWithColumns.columnSidecars.map((c) => c.index);
      const response = await fetchColumnsByRoot({
        network,
        peerMeta,
        blockRoot,
        columnMeta: {
          missing,
          versionedHashes: [],
        },
      });
      expect(response).toEqual(fuluBlockWithColumns.columnSidecars);
      expect(network.sendDataColumnSidecarsByRoot).toHaveBeenCalledOnce();
      expect(network.sendDataColumnSidecarsByRoot).toHaveBeenCalledWith(peerIdStr, [{blockRoot, columns: missing}]);
    });
  });
});
