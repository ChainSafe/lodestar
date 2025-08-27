import {randomBytes} from "node:crypto";
import {BYTES_PER_BLOB, BYTES_PER_CELL, BYTES_PER_COMMITMENT, BYTES_PER_PROOF} from "@crate-crypto/node-eth-kzg";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {deneb, fulu, ssz} from "@lodestar/types";
import {prettyBytes} from "@lodestar/utils";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {
  BlobMeta,
  // IBlockInput,
  MissingColumnMeta,
} from "../../../../src/chain/blocks/blockInput/types.js";
// import {ChainEventEmitter} from "../../../../src/chain/index.js";
// import {SeenBlockInput} from "../../../../src/chain/seenCache/seenGossipBlockInput.js";
import {IExecutionEngine} from "../../../../src/execution/index.js";
import {INetwork, prettyPrintPeerIdStr} from "../../../../src/network/index.js";
// import {BlockInputSyncCacheItem, PendingBlockInput, PendingBlockInputStatus} from "../../../../src/sync/types.js";
import {
  DownloadByRootError,
  DownloadByRootErrorCode,
  ValidateColumnSidecarsProps,
  fetchAndValidateBlobs,
  fetchAndValidateBlock,
  // downloadByRoot,
  // fetchAndValidateBlobs,
  // fetchAndValidateBlock,
  // fetchAndValidateColumns,
  fetchBlobsByRoot,
  // fetchByRoot,
  fetchColumnsByRoot,
  fetchGetBlobsV1AndBuildSidecars,
  // fetchGetBlobsV1AndBuildSidecars,
  fetchGetBlobsV2AndBuildSidecars,
  validateBlobs,
  validateColumnSidecar,
  validateColumnSidecars,
} from "../../../../src/sync/utils/downloadByRoot.js";
import {kzgCommitmentToVersionedHash} from "../../../../src/util/blobs.js";
// import {Clock} from "../../../../src/util/clock.js";
import {kzg} from "../../../../src/util/kzg.js";
import {ROOT_SIZE} from "../../../../src/util/sszBytes.js";
// import {getMockedLogger} from "../../../../test/mocks/loggerMock.js";
import {
  config,
  gen,
  generateBlock,
  // custodyConfig,
  generateBlockWithBlobSidecars,
  generateBlockWithColumnSidecars,
  // generateChainOfBlocks,
  // slots,
} from "../../../utils/blocksAndData.js";

describe("downloadByRoot.ts", () => {
  const peerIdStr = "1234567890abcdef1234567890abcdef";
  const prettyPeerIdStr = prettyPrintPeerIdStr(peerIdStr);
  let network: INetwork;
  // let cache: SeenBlockInput;
  let executionEngine: IExecutionEngine;
  // const logger = getMockedLogger();

  // Test data
  // let capellaBlock: SignedBeaconBlock;
  // let denebBlockWithBlobs: ReturnType<typeof generateBlockWithBlobSidecars>;
  // let fuluBlockWithColumns: ReturnType<typeof generateBlockWithColumnSidecars>;
  // let blockRoot: Uint8Array;
  // let rootHex: string;

  beforeAll(() => {
    // Generate test blocks
    // const capellaBlocks = generateChainOfBlocks({forkName: ForkName.capella, count: 1});
    // capellaBlock = capellaBlocks[0].block;
    // denebBlockWithBlobs = generateBlockWithBlobSidecars({forkName: ForkName.deneb});
    // fuluBlockWithColumns = generateBlockWithColumnSidecars({forkName: ForkName.fulu});
    // blockRoot = denebBlockWithBlobs.blockRoot;
    // rootHex = denebBlockWithBlobs.rootHex;
  });

  beforeEach(() => {
    // const abortController = new AbortController();
    // const signal = abortController.signal;
    // cache = new SeenBlockInput({
    //   config,
    //   custodyConfig,
    //   clock: new Clock({config, signal, genesisTime: Math.floor(Date.now() / 1000)}),
    //   chainEvents: new ChainEventEmitter(),
    //   signal,
    //   metrics: null,
    //   logger,
    // });
    // network = {
    //   sendBeaconBlocksByRoot: vi.fn(),
    //   sendBlobSidecarsByRoot: vi.fn(),
    //   sendDataColumnSidecarsByRoot: vi.fn(),
    //   publishDataColumnSidecar: vi.fn(),
    //   custodyConfig,
    //   logger,
    // } as unknown as INetwork;
    // executionEngine = {
    //   getBlobs: vi.fn(),
    // } as unknown as IExecutionEngine;
  });

  // describe("downloadByRoot", () => {
  //   it("should successfully download block with blobs for post-Deneb fork", () => {
  //     // Test downloading a block with blob sidecars in post-Deneb fork
  //   });

  //   it("should successfully download block with columns for post-Fulu fork", () => {
  //     // Test downloading a block with column sidecars in post-Fulu fork
  //   });

  //   it("should successfully download block without additional data for pre-Deneb fork", () => {
  //     // Test downloading a simple block in pre-Deneb fork
  //   });

  //   it("should handle pending block input that already has block", () => {
  //     // Test case where cacheItem is PendingBlockInput and already has the block
  //   });

  //   it("should handle pending block input that needs block and data", () => {
  //     // Test case where cacheItem is PendingBlockInput but missing block and data
  //   });

  //   it("should handle non-pending cache item", () => {
  //     // Test case where cacheItem is not PendingBlockInput
  //   });

  //   it("should throw error when blob sidecars are missing for blob input", () => {
  //     // Test MISSING_BLOB_RESPONSE error
  //   });

  //   it("should throw error when column sidecars are missing for column input", () => {
  //     // Test MISSING_COLUMN_RESPONSE error
  //   });

  //   it("should return downloaded status when block has all data", () => {
  //     // Test status is set to downloaded when blockInput.hasBlockAndAllData() returns true
  //   });

  //   it("should return pending status when block is missing data", () => {
  //     // Test status is set to pending when blockInput.hasBlockAndAllData() returns false
  //   });
  // });

  // describe("fetchByRoot", () => {
  //   it("should fetch block and blobs for pending block input in post-Deneb fork", () => {
  //     // Test fetching when cacheItem is PendingBlockInput and fork is post-Deneb
  //   });

  //   it("should fetch block and columns for pending block input in post-Fulu fork", () => {
  //     // Test fetching when cacheItem is PendingBlockInput and fork is post-Fulu
  //   });

  //   it("should use existing block from pending block input", () => {
  //     // Test when cacheItem.blockInput.hasBlock() returns true
  //   });

  //   it("should fetch new block when pending block input doesn't have block", () => {
  //     // Test when cacheItem.blockInput.hasBlock() returns false
  //   });

  //   it("should skip data fetching when pending block input has all data", () => {
  //     // Test when cacheItem.blockInput.hasAllData() returns true
  //   });

  //   it("should fetch blobs when pending block input is missing blob data", () => {
  //     // Test blob fetching for incomplete blob input
  //   });

  //   it("should fetch columns when pending block input is missing column data", () => {
  //     // Test column fetching for incomplete column input
  //   });

  //   it("should fetch block and blobs for non-pending cache item in post-Deneb fork", () => {
  //     // Test fetching for non-PendingBlockInput in post-Deneb
  //   });

  //   it("should fetch block and columns for non-pending cache item in post-Fulu fork", () => {
  //     // Test fetching for non-PendingBlockInput in post-Fulu
  //   });

  //   it("should fetch only block for non-pending cache item in pre-Deneb fork", () => {
  //     // Test fetching for non-PendingBlockInput in pre-Deneb
  //   });
  // });

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

      try {
        await fetchAndValidateBlock({
          config,
          network,
          peerIdStr,
          blockRoot: capellaBlock.blockRoot,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadByRootError);
        expect((err as any).type.code).toEqual(DownloadByRootErrorCode.MISSING_BLOCK_RESPONSE);
        expect((err as any).type.peer).toEqual(prettyPeerIdStr);
        expect((err as any).type.blockRoot).toEqual(prettyBytes(capellaBlock.blockRoot));
      }
    });

    it("should throw error when block root doesn't match requested root", async () => {
      network = {
        sendBeaconBlocksByRoot: vi.fn(() => [{data: capellaBlock.block}]),
      } as unknown as INetwork;

      const invalidRoot = randomBytes(ROOT_SIZE);
      try {
        await fetchAndValidateBlock({
          config,
          network,
          peerIdStr,
          blockRoot: invalidRoot,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadByRootError);
        expect((err as any).message).toEqual("block does not match requested root");
        expect((err as any).type.code).toEqual(DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT);
        expect((err as any).type.peer).toEqual(prettyPeerIdStr);
        expect((err as any).type.requestedBlockRoot).toEqual(prettyBytes(invalidRoot));
        expect((err as any).type.receivedBlockRoot).toEqual(prettyBytes(capellaBlock.blockRoot));
      }
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

      try {
        await fetchAndValidateBlobs({
          config,
          network,
          executionEngine,
          forkName,
          peerIdStr,
          blockRoot: requestedBlockRoot,
          block: denebBlockWithBlobs.block,
          blobMeta,
        });
        expect.fail("should have errored");
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadByRootError);
        expect((err as any).type.code).toBe(DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT);
        expect((err as any).type.peer).toBe(prettyPeerIdStr);
        expect((err as any).type.requestedBlockRoot).toBe(prettyBytes(requestedBlockRoot));
        expect((err as any).type.receivedBlockRoot).toBe(prettyBytes(denebBlockWithBlobs.blockRoot));
        expect((err as any).message).toEqual("blobSidecar header root did not match requested blockRoot for index=0");
      }
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
      blobMeta = denebBlockWithBlobs.versionedHashes.map((versionedHash, index) => ({index, versionedHash}));
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
        validateBlobs({
          config,
          peerIdStr,
          blockRoot: denebBlockWithBlobs.blockRoot,
          blobSidecars: response,
          blobMeta,
        })
      ).resolves.toBeUndefined();
    });

    it("should handle partial blob response from execution engine", async () => {
      const engineResponse = [...blobsAndProofs];
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

  describe("validateBlobs", () => {
    let denebBlockWithBlobs: ReturnType<typeof generateBlockWithBlobSidecars>;
    let blockRoot: Uint8Array;
    let blobMeta: BlobMeta[];
    let blobSidecars: deneb.BlobSidecars;

    beforeAll(() => {
      denebBlockWithBlobs = generateBlockWithBlobSidecars({forkName: ForkName.deneb});
      blockRoot = denebBlockWithBlobs.blockRoot;
      blobSidecars = denebBlockWithBlobs.blobSidecars;
      blobMeta = blobSidecars.map((b) => ({index: b.index}) as BlobMeta);
    });

    it("should successfully validate all blobSidecars", async () => {
      await expect(
        validateBlobs({
          config,
          peerIdStr,
          blockRoot,
          blobMeta,
          blobSidecars,
        })
      ).resolves.toBeUndefined();
    });

    it("should throw error for extra un-requested blobSidecar", async () => {
      try {
        await validateBlobs({
          config,
          peerIdStr,
          blockRoot,
          blobMeta: blobMeta.slice(0, -1),
          blobSidecars,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadByRootError);
        expect((err as any).type.code).toBe(DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED);
        expect((err as any).type.peer).toBe(prettyPeerIdStr);
        expect((err as any).type.blockRoot).toBe(prettyBytes(blockRoot));
        expect((err as any).type.invalidIndex).toBe(blobMeta.at(-1)?.index);
        expect((err as any).message).toBe("received a blobSidecar that was not requested");
      }
    });

    it("should throw error for mismatched block root in blob header", async () => {
      const requestedBlockRoot = new Uint8Array(ROOT_SIZE).fill(0xac);
      try {
        await validateBlobs({
          config,
          peerIdStr,
          blockRoot: requestedBlockRoot,
          blobMeta,
          blobSidecars,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadByRootError);
        expect((err as any).type.code).toBe(DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT);
        expect((err as any).type.peer).toBe(prettyPeerIdStr);
        expect((err as any).type.requestedBlockRoot).toBe(prettyBytes(requestedBlockRoot));
        expect((err as any).type.receivedBlockRoot).toBe(prettyBytes(denebBlockWithBlobs.blockRoot));
        expect((err as any).message).toEqual("blobSidecar header root did not match requested blockRoot for index=0");
      }
    });

    it("should throw error for invalid inclusion proof", async () => {
      const invalidBlobSidecar = ssz.deneb.BlobSidecar.clone(denebBlockWithBlobs.blobSidecars[0]);
      // Corrupt the inclusion proof to make it invalid
      invalidBlobSidecar.kzgCommitmentInclusionProof[0] = new Uint8Array(32).fill(255);

      try {
        await validateBlobs({
          config,
          peerIdStr,
          blockRoot,
          blobMeta: [blobMeta[0]],
          blobSidecars: [invalidBlobSidecar],
        });
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadByRootError);
        expect((err as any).type.code).toBe(DownloadByRootErrorCode.INVALID_INCLUSION_PROOF);
        expect((err as any).type.peer).toBe(prettyPeerIdStr);
        expect((err as any).type.blockRoot).toBe(prettyBytes(blockRoot));
        expect((err as any).type.sidecarIndex).toBe(invalidBlobSidecar.index);
        expect((err as any).message).toEqual("invalid inclusion proof for blobSidecar at index=0");
      }
    });

    it("should throw error for invalid KZG proof", async () => {
      const invalidBlobSidecar = ssz.deneb.BlobSidecar.clone(denebBlockWithBlobs.blobSidecars[0]);
      // Corrupt a single proof in the batch and make sure all trip as invalid
      invalidBlobSidecar.kzgProof = new Uint8Array(48).fill(255);

      try {
        await validateBlobs({
          config,
          peerIdStr,
          blockRoot,
          blobMeta,
          blobSidecars: [invalidBlobSidecar, ...blobSidecars.slice(1)],
        });
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadByRootError);
        expect((err as any).type.code).toBe(DownloadByRootErrorCode.INVALID_KZG_PROOF);
        expect((err as any).type.peer).toBe(prettyPeerIdStr);
        expect((err as any).type.blockRoot).toBe(prettyBytes(blockRoot));
      }
    });
  });

  // describe("fetchAndValidateColumns", () => {
  //   it("should fetch columns from execution engine and validate", () => {
  //     // Test successful fetch from execution engine
  //   });

  //   it("should gracefully handle executionEngine errors", () => {
  //     // Test needToPublish logic with custody configuration
  //   });

  //   it("should fetch columns from network when execution engine returns empty", () => {
  //     // Test fallback to network when execution engine fails
  //   });

  //   it("should publish reconstructed columns to network", () => {
  //     // Test column publishing after reconstruction
  //   });

  //   it("should filter needed columns from reconstructed set", () => {
  //     // Test that only needed columns are returned
  //   });

  //   it("should handle publishing errors gracefully", () => {
  //     // Test that publishing errors don't fail the main operation
  //   });

  //   it("should validate columns correctly in both scenarios", () => {
  //     // Test validation works for both execution engine and network paths
  //   });

  //   it("should determine correct columns to publish based on custody config", () => {
  //     // Test needToPublish logic with custody configuration
  //   });

  // });

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
      for (const [index, columnSidecar] of Object.entries(result)) {
        expect(columnSidecar).toHaveProperty("column");
        expect(columnSidecar.column).toBeInstanceOf(Array);
        columnSidecar.column.map((cell) => expect(cell).toBeInstanceOf(Uint8Array));
        expect(columnSidecar.column.length).toEqual(fuluBlockWithColumns.block.message.body.blobKzgCommitments.length);

        expect(columnSidecar).toHaveProperty("index");
        expect(columnSidecar.index).toBeTypeOf("number");
        expect(columnSidecar.index).toEqual(parseInt(index));

        expect(columnSidecar).toHaveProperty("kzgCommitments");
        expect(columnSidecar.kzgCommitments).toBeInstanceOf(Array);
        columnSidecar.kzgCommitments.map((c) => expect(c).toBeInstanceOf(Uint8Array));
        expect(columnSidecar.kzgCommitments.toString()).toEqual(
          fuluBlockWithColumns.block.message.body.blobKzgCommitments.toString()
        );

        expect(columnSidecar).toHaveProperty("kzgProofs");
        expect(columnSidecar.kzgProofs).toBeInstanceOf(Array);
        columnSidecar.kzgProofs.map((proof) => expect(proof).toBeInstanceOf(Uint8Array));
        expect(columnSidecar.kzgProofs.length).toEqual(columnSidecar.column.length);

        expect(columnSidecar).toHaveProperty("kzgCommitmentsInclusionProof");
        expect(columnSidecar.kzgCommitmentsInclusionProof).toBeInstanceOf(Array);
        columnSidecar.kzgCommitmentsInclusionProof.map((proof) => expect(proof).toBeInstanceOf(Uint8Array));

        // // Verify the signed block header matches the block
        expect(columnSidecar).toHaveProperty("signedBlockHeader");
        expect(columnSidecar.signedBlockHeader.message.slot).toBe(fuluBlockWithColumns.block.message.slot);
        expect(columnSidecar.signedBlockHeader.message.proposerIndex).toBe(
          fuluBlockWithColumns.block.message.proposerIndex
        );
        expect(columnSidecar.signedBlockHeader.message.parentRoot).toEqual(
          fuluBlockWithColumns.block.message.parentRoot
        );
        expect(columnSidecar.signedBlockHeader.message.stateRoot).toEqual(fuluBlockWithColumns.block.message.stateRoot);

        expect(
          validateColumnSidecar({config, peerIdStr, blockRoot: fuluBlockWithColumns.blockRoot, columnSidecar})
        ).toBeUndefined();
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
        peerIdStr,
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

  describe("validateColumnSidecar", () => {
    let fuluBlockWithColumns: ReturnType<typeof generateBlockWithColumnSidecars>;

    beforeAll(() => {
      fuluBlockWithColumns = generateBlockWithColumnSidecars({forkName: ForkName.fulu});
    });

    it("should successfully validate column sidecar", () => {
      const columnSidecar = fuluBlockWithColumns.columnSidecars[0];
      const testBlockRoot = fuluBlockWithColumns.blockRoot;

      // This should not throw
      expect(() => {
        validateColumnSidecar({
          config,
          peerIdStr,
          blockRoot: testBlockRoot,
          columnSidecar,
        });
      }).not.toThrow();
    });

    it("should throw error for mismatched block root in column header", () => {
      const columnSidecar = fuluBlockWithColumns.columnSidecars[0];
      const wrongBlockRoot = new Uint8Array(32).fill(1);
      try {
        validateColumnSidecar({
          config,
          peerIdStr,
          blockRoot: wrongBlockRoot,
          columnSidecar,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(DownloadByRootError);
        expect((error as any).type.code).toBe(DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT);
        expect((error as any).type.peer).toBe(prettyPeerIdStr);
        expect((error as any).type.requestedBlockRoot).toBe(prettyBytes(wrongBlockRoot));
      }
    });

    it("should throw error for invalid inclusion proof", () => {
      const columnSidecar = ssz.fulu.DataColumnSidecar.clone(fuluBlockWithColumns.columnSidecars[0]);
      // Corrupt the inclusion proof to make it invalid
      columnSidecar.kzgCommitmentsInclusionProof[0] = new Uint8Array(32).fill(255);
      try {
        validateColumnSidecar({
          config,
          peerIdStr,
          blockRoot: fuluBlockWithColumns.blockRoot,
          columnSidecar,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadByRootError);
        expect((err as any).type.code).toBe(DownloadByRootErrorCode.INVALID_INCLUSION_PROOF);
        expect((err as any).type.peer).toBe(prettyPeerIdStr);
        expect((err as any).type.blockRoot).toBe(prettyBytes(fuluBlockWithColumns.blockRoot));
        expect((err as any).type.sidecarIndex).toBe(columnSidecar.index);
      }
    });
  });

  describe("validateColumnSidecars", () => {
    let fuluBlockWithColumns: ReturnType<typeof generateBlockWithColumnSidecars>;
    let blockRoot: Uint8Array;
    let columnMeta: MissingColumnMeta;

    beforeAll(() => {
      fuluBlockWithColumns = generateBlockWithColumnSidecars({forkName: ForkName.fulu});
      blockRoot = fuluBlockWithColumns.blockRoot;
      columnMeta = {
        missing: fuluBlockWithColumns.columnSidecars.map((c) => c.index),
        versionedHashes: [],
      };
    });

    it("should successfully validate all needed column sidecars", async () => {
      await expect(
        validateColumnSidecars({
          config,
          peerIdStr,
          blockRoot,
          columnMeta,
          needed: fuluBlockWithColumns.columnSidecars,
        })
      ).resolves.toBeUndefined();
    });

    it("should successfully validate needToPublish columns", async () => {
      await expect(
        validateColumnSidecars({
          config,
          peerIdStr,
          blockRoot,
          columnMeta,
          needToPublish: fuluBlockWithColumns.columnSidecars,
        })
      ).resolves.toBeUndefined();
    });

    it("should throw error for extra un-requested column sidecar", async () => {
      const testProps = {
        config,
        peerIdStr,
        blockRoot,
        columnMeta: {
          ...columnMeta,
          missing: Array.from({length: 18}, (_, i) => i),
        },
        needed: fuluBlockWithColumns.columnSidecars,
      };
      await expect(validateColumnSidecars(testProps)).rejects.toThrow();

      try {
        await validateColumnSidecars(testProps);
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadByRootError);
        expect((err as any).type.code).toBe(DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED);
        expect((err as any).type.peer).toBe(prettyPeerIdStr);
        expect((err as any).type.blockRoot).toBe(prettyBytes(blockRoot));
        expect((err as any).type.invalidIndex).toBe(18);
        expect((err as any).message).toBe("Received a columnSidecar that was not requested");
      }
    });

    it("should invalidate individual needed column sidecar correctly", async () => {
      // Create an invalid column with bad inclusion proof to trigger the final validation error
      const invalidColumn = ssz.fulu.DataColumnSidecar.clone(fuluBlockWithColumns.columnSidecars[127]);
      invalidColumn.kzgCommitmentsInclusionProof[0] = new Uint8Array(32).fill(255);

      const invalidTestProps = {
        config,
        peerIdStr,
        blockRoot,
        columnMeta,
        needed: [...fuluBlockWithColumns.columnSidecars.slice(0, -1), invalidColumn],
      };

      try {
        await validateColumnSidecars(invalidTestProps);
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadByRootError);
        expect((err as any).type.code).toBe(DownloadByRootErrorCode.INVALID_INCLUSION_PROOF);
        expect((err as any).type.peer).toBe(prettyPeerIdStr);
        expect((err as any).type.blockRoot).toBe(prettyBytes(fuluBlockWithColumns.blockRoot));
        expect((err as any).type.sidecarIndex).toBe(127);
        expect((err as any).message).toBe(
          "Error validating needed columnSidecar index=127. Validation error: DOWNLOAD_BY_ROOT_ERROR_INVALID_INCLUSION_PROOF"
        );
      }
    });

    it("should invalidate individual needToPublish column sidecar correctly", async () => {
      // Create an invalid column with bad inclusion proof to trigger the final validation error
      const invalidColumn = ssz.fulu.DataColumnSidecar.clone(fuluBlockWithColumns.columnSidecars[127]);
      invalidColumn.kzgCommitmentsInclusionProof[0] = new Uint8Array(32).fill(255);

      const invalidTestProps = {
        config,
        peerIdStr,
        blockRoot,
        columnMeta,
        needToPublish: [...fuluBlockWithColumns.columnSidecars.slice(0, -1), invalidColumn],
      };

      try {
        await validateColumnSidecars(invalidTestProps);
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadByRootError);
        expect((err as any).type.code).toBe(DownloadByRootErrorCode.INVALID_INCLUSION_PROOF);
        expect((err as any).type.peer).toBe(prettyPeerIdStr);
        expect((err as any).type.blockRoot).toBe(prettyBytes(fuluBlockWithColumns.blockRoot));
        expect((err as any).type.sidecarIndex).toBe(127);
        expect((err as any).message).toBe(
          "Error validating needToPublish columnSidecar index=127. Validation error: DOWNLOAD_BY_ROOT_ERROR_INVALID_INCLUSION_PROOF"
        );
      }
    });

    it("should avoid duplicate validation for columns in both arrays", async () => {
      // Use valid columns to simplify the test setup
      const sharedColumns = fuluBlockWithColumns.columnSidecars.slice(0, 2);
      const uniqueNeededColumns = fuluBlockWithColumns.columnSidecars.slice(2, 4);
      const uniquePublishColumns = fuluBlockWithColumns.columnSidecars.slice(4, 6);
      const validateFn = vi.fn();

      const testProps: ValidateColumnSidecarsProps = {
        config,
        peerIdStr,
        blockRoot,
        columnMeta: {
          missing: [...sharedColumns, ...uniqueNeededColumns, ...uniquePublishColumns].map((c) => c.index),
          versionedHashes: columnMeta.versionedHashes,
        },
        needed: [...sharedColumns, ...uniqueNeededColumns], // 4 columns total (2 shared + 2 unique)
        needToPublish: [...sharedColumns, ...uniquePublishColumns], // 4 columns total (2 shared + 2 unique to publish)
        validateFn,
      };

      await expect(validateColumnSidecars(testProps)).resolves.toBeUndefined();
      const validateCommonProps = {
        config,
        peerIdStr,
        blockRoot,
      };
      expect(validateFn).toHaveBeenCalledTimes(6);
      expect(validateFn).toHaveBeenNthCalledWith(1, {
        ...validateCommonProps,
        columnSidecar: sharedColumns[0],
      });
      expect(validateFn).toHaveBeenNthCalledWith(2, {
        ...validateCommonProps,
        columnSidecar: sharedColumns[1],
      });
      expect(validateFn).toHaveBeenNthCalledWith(3, {
        ...validateCommonProps,
        columnSidecar: uniqueNeededColumns[0],
      });
      expect(validateFn).toHaveBeenNthCalledWith(4, {
        ...validateCommonProps,
        columnSidecar: uniqueNeededColumns[1],
      });
      expect(validateFn).toHaveBeenNthCalledWith(5, {
        ...validateCommonProps,
        columnSidecar: uniquePublishColumns[0],
      });
      expect(validateFn).toHaveBeenNthCalledWith(6, {
        ...validateCommonProps,
        columnSidecar: uniquePublishColumns[1],
      });
    });

    it("should throw error for invalid KZG proofs", async () => {
      let invalidColumn = ssz.fulu.DataColumnSidecar.clone(fuluBlockWithColumns.columnSidecars[0]);
      // Corrupt one of the KZG proofs to make it invalid
      invalidColumn.kzgProofs[0] = new Uint8Array(BYTES_PER_PROOF).fill(255);

      let testProps = {
        config,
        peerIdStr,
        blockRoot,
        columnMeta,
        needed: [invalidColumn, ...fuluBlockWithColumns.columnSidecars.slice(1)],
      };

      try {
        await validateColumnSidecars(testProps);
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadByRootError);
        expect((err as any).type.code).toBe(DownloadByRootErrorCode.INVALID_KZG_PROOF);
        expect((err as any).type.peer).toBe(prettyPeerIdStr);
        expect((err as any).type.blockRoot).toBe(prettyBytes(blockRoot));
      }

      invalidColumn = ssz.fulu.DataColumnSidecar.clone(fuluBlockWithColumns.columnSidecars[0]);
      // Corrupt one of the cells to make it invalid
      invalidColumn.column[0] = new Uint8Array(BYTES_PER_CELL).fill(255);

      testProps = {
        config,
        peerIdStr,
        blockRoot,
        columnMeta,
        needed: [invalidColumn, ...fuluBlockWithColumns.columnSidecars.slice(1)],
      };

      try {
        await validateColumnSidecars(testProps);
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadByRootError);
        expect((err as any).type.code).toBe(DownloadByRootErrorCode.INVALID_KZG_PROOF);
        expect((err as any).type.peer).toBe(prettyPeerIdStr);
        expect((err as any).type.blockRoot).toBe(prettyBytes(blockRoot));
      }
    });
  });

  describe("DownloadByRootError", () => {
    const blockRoot = randomBytes(ROOT_SIZE);

    it("should create error with MISMATCH_BLOCK_ROOT code", () => {
      const err = new DownloadByRootError({
        code: DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT,
        peer: peerIdStr,
        requestedBlockRoot: prettyBytes(blockRoot),
        receivedBlockRoot: prettyBytes(new Uint8Array(32).fill(1)),
      });

      expect(err as any).toBeInstanceOf(DownloadByRootError);
      expect((err as any).type.code).toBe(DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT);
      expect((err as any).type.peer).toBe(peerIdStr);
      expect((err as any).type.requestedBlockRoot).toBe(prettyBytes(blockRoot));
      expect((err as any).type.receivedBlockRoot).toBe(prettyBytes(new Uint8Array(32).fill(1)));
    });

    it("should create error with EXTRA_SIDECAR_RECEIVED code", () => {
      const err = new DownloadByRootError({
        code: DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED,
        peer: peerIdStr,
        blockRoot: prettyBytes(blockRoot),
        invalidIndex: 5,
      });

      expect(err as any).toBeInstanceOf(DownloadByRootError);
      expect((err as any).type.code).toBe(DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED);
      expect((err as any).type.peer).toBe(peerIdStr);
      expect((err as any).type.blockRoot).toBe(prettyBytes(blockRoot));
      expect((err as any).type.invalidIndex).toBe(5);
    });

    it("should create error with INVALID_INCLUSION_PROOF code", () => {
      const err = new DownloadByRootError({
        code: DownloadByRootErrorCode.INVALID_INCLUSION_PROOF,
        peer: peerIdStr,
        blockRoot: prettyBytes(blockRoot),
        sidecarIndex: 2,
      });

      expect(err as any).toBeInstanceOf(DownloadByRootError);
      expect((err as any).type.code).toBe(DownloadByRootErrorCode.INVALID_INCLUSION_PROOF);
      expect((err as any).type.peer).toBe(peerIdStr);
      expect((err as any).type.blockRoot).toBe(prettyBytes(blockRoot));
      expect((err as any).type.sidecarIndex).toBe(2);
    });

    it("should create error with INVALID_KZG_PROOF code", () => {
      const err = new DownloadByRootError({
        code: DownloadByRootErrorCode.INVALID_KZG_PROOF,
        peer: peerIdStr,
        blockRoot: prettyBytes(blockRoot),
      });

      expect(err as any).toBeInstanceOf(DownloadByRootError);
      expect((err as any).type.code).toBe(DownloadByRootErrorCode.INVALID_KZG_PROOF);
      expect((err as any).type.peer).toBe(peerIdStr);
      expect((err as any).type.blockRoot).toBe(prettyBytes(blockRoot));
    });

    it("should create error with MISSING_BLOCK_RESPONSE code", () => {
      const err = new DownloadByRootError({
        code: DownloadByRootErrorCode.MISSING_BLOCK_RESPONSE,
        peer: peerIdStr,
        blockRoot: prettyBytes(blockRoot),
      });

      expect(err as any).toBeInstanceOf(DownloadByRootError);
      expect((err as any).type.code).toBe(DownloadByRootErrorCode.MISSING_BLOCK_RESPONSE);
      expect((err as any).type.peer).toBe(peerIdStr);
      expect((err as any).type.blockRoot).toBe(prettyBytes(blockRoot));
    });

    it("should create error with MISSING_BLOB_RESPONSE code", () => {
      const err = new DownloadByRootError({
        code: DownloadByRootErrorCode.MISSING_BLOB_RESPONSE,
        peer: peerIdStr,
        blockRoot: prettyBytes(blockRoot),
      });

      expect(err as any).toBeInstanceOf(DownloadByRootError);
      expect((err as any).type.code).toBe(DownloadByRootErrorCode.MISSING_BLOB_RESPONSE);
      expect((err as any).type.peer).toBe(peerIdStr);
      expect((err as any).type.blockRoot).toBe(prettyBytes(blockRoot));
    });

    it("should create error with MISSING_COLUMN_RESPONSE code", () => {
      const err = new DownloadByRootError({
        code: DownloadByRootErrorCode.MISSING_COLUMN_RESPONSE,
        peer: peerIdStr,
        blockRoot: prettyBytes(blockRoot),
      });

      expect(err as any).toBeInstanceOf(DownloadByRootError);
      expect((err as any).type.code).toBe(DownloadByRootErrorCode.MISSING_COLUMN_RESPONSE);
      expect((err as any).type.peer).toBe(peerIdStr);
      expect((err as any).type.blockRoot).toBe(prettyBytes(blockRoot));
    });

    it("should include correct error details in error object", () => {
      const errorData = {
        code: DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT,
        peer: peerIdStr,
        requestedBlockRoot: prettyBytes(blockRoot),
        receivedBlockRoot: prettyBytes(new Uint8Array(32).fill(1)),
      };
      const err = new DownloadByRootError(errorData as any);

      expect(err.type).toEqual(errorData);
      expect(Object.keys(err.type)).toEqual(Object.keys(errorData));
    });
  });
});
