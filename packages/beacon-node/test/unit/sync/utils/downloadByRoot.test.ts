import {ForkName} from "@lodestar/params";
import {SignedBeaconBlock, deneb, fulu, ssz} from "@lodestar/types";
import {fromHex, prettyBytes, toRootHex} from "@lodestar/utils";
import {Mock, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {BlockInputSource, IBlockInput} from "../../../../src/chain/blocks/blockInput/types.js";
import {ChainEventEmitter} from "../../../../src/chain/index.js";
import {SeenBlockInput} from "../../../../src/chain/seenCache/seenGossipBlockInput.js";
import {IExecutionEngine} from "../../../../src/execution/index.js";
import {INetwork} from "../../../../src/network/index.js";
import {BlockInputSyncCacheItem, PendingBlockInput, PendingBlockInputStatus} from "../../../../src/sync/types.js";
import {
  DownloadByRootError,
  DownloadByRootErrorCode,
  downloadByRoot,
  fetchAndValidateBlobs,
  fetchAndValidateBlock,
  fetchAndValidateColumns,
  fetchBlobByRoot,
  fetchByRoot,
  fetchColumnsByRoot,
  fetchGetBlobsV1AndBuildSidecars,
  fetchGetBlobsV2AndBuildSidecars,
  validateBlobs,
  validateColumnSidecar,
  validateColumnSidecars,
} from "../../../../src/sync/utils/downloadByRoot.js";
import {kzgCommitmentToVersionedHash} from "../../../../src/util/blobs.js";
import {Clock} from "../../../../src/util/clock.js";
import {getMockedLogger} from "../../../../test/mocks/loggerMock.js";
import {
  config,
  custodyConfig,
  generateBlockWithBlobSidecars,
  generateBlockWithColumnSidecars,
  generateChainOfBlocks,
  slots,
} from "../../../utils/blocksAndData.js";

describe("downloadByRoot.ts", () => {
  const peerIdStr = "0x1234567890abcdef";
  // let cache: SeenBlockInput;
  // let network: INetwork;
  // let executionEngine: IExecutionEngine;
  const logger = getMockedLogger();

  // Test data
  // let capellaBlock: SignedBeaconBlock;
  let denebBlockWithBlobs: ReturnType<typeof generateBlockWithBlobSidecars>;
  let fuluBlockWithColumns: ReturnType<typeof generateBlockWithColumnSidecars>;
  let blockRoot: Uint8Array;
  // let rootHex: string;

  beforeAll(() => {
    // Generate test blocks
    // const capellaBlocks = generateChainOfBlocks({forkName: ForkName.capella, count: 1});
    // capellaBlock = capellaBlocks[0].block;

    denebBlockWithBlobs = generateBlockWithBlobSidecars({forkName: ForkName.deneb});
    fuluBlockWithColumns = generateBlockWithColumnSidecars({forkName: ForkName.fulu});

    blockRoot = denebBlockWithBlobs.blockRoot;
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

  describe("downloadByRoot", () => {
    it("should successfully download block with blobs for post-Deneb fork", () => {
      // Test downloading a block with blob sidecars in post-Deneb fork
    });

    it("should successfully download block with columns for post-Fulu fork", () => {
      // Test downloading a block with column sidecars in post-Fulu fork
    });

    it("should successfully download block without additional data for pre-Deneb fork", () => {
      // Test downloading a simple block in pre-Deneb fork
    });

    it("should handle pending block input that already has block", () => {
      // Test case where cacheItem is PendingBlockInput and already has the block
    });

    it("should handle pending block input that needs block and data", () => {
      // Test case where cacheItem is PendingBlockInput but missing block and data
    });

    it("should handle non-pending cache item", () => {
      // Test case where cacheItem is not PendingBlockInput
    });

    it("should throw error when blob sidecars are missing for blob input", () => {
      // Test MISSING_BLOB_RESPONSE error
    });

    it("should throw error when column sidecars are missing for column input", () => {
      // Test MISSING_COLUMN_RESPONSE error
    });

    it("should return downloaded status when block has all data", () => {
      // Test status is set to downloaded when blockInput.hasBlockAndAllData() returns true
    });

    it("should return pending status when block is missing data", () => {
      // Test status is set to pending when blockInput.hasBlockAndAllData() returns false
    });
  });

  describe("fetchByRoot", () => {
    it("should fetch block and blobs for pending block input in post-Deneb fork", () => {
      // Test fetching when cacheItem is PendingBlockInput and fork is post-Deneb
    });

    it("should fetch block and columns for pending block input in post-Fulu fork", () => {
      // Test fetching when cacheItem is PendingBlockInput and fork is post-Fulu
    });

    it("should use existing block from pending block input", () => {
      // Test when cacheItem.blockInput.hasBlock() returns true
    });

    it("should fetch new block when pending block input doesn't have block", () => {
      // Test when cacheItem.blockInput.hasBlock() returns false
    });

    it("should skip data fetching when pending block input has all data", () => {
      // Test when cacheItem.blockInput.hasAllData() returns true
    });

    it("should fetch blobs when pending block input is missing blob data", () => {
      // Test blob fetching for incomplete blob input
    });

    it("should fetch columns when pending block input is missing column data", () => {
      // Test column fetching for incomplete column input
    });

    it("should fetch block and blobs for non-pending cache item in post-Deneb fork", () => {
      // Test fetching for non-PendingBlockInput in post-Deneb
    });

    it("should fetch block and columns for non-pending cache item in post-Fulu fork", () => {
      // Test fetching for non-PendingBlockInput in post-Fulu
    });

    it("should fetch only block for non-pending cache item in pre-Deneb fork", () => {
      // Test fetching for non-PendingBlockInput in pre-Deneb
    });
  });

  describe("fetchAndValidateBlock", () => {
    it("should successfully fetch and validate block with matching root", () => {
      // Test successful block fetch and validation
    });

    it("should throw error when no block is returned from network", () => {
      // Test MISSING_BLOCK_RESPONSE error
    });

    it("should throw error when block root doesn't match requested root", () => {
      // Test MISMATCH_BLOCK_ROOT error
    });

    it("should handle network request failure", () => {
      // Test network failure scenarios
    });
  });

  describe("fetchAndValidateBlobs", () => {
    it("should successfully fetch blobs from execution engine only", () => {
      // Test when all blobs are available from execution engine
    });

    it("should fetch remaining blobs from network when execution engine is incomplete", () => {
      // Test when some blobs are from execution engine, others from network
    });

    it("should fetch all blobs from network when execution engine returns none", () => {
      // Test when execution engine returns no blobs
    });

    it("should validate all fetched blobs successfully", () => {
      // Test successful blob validation
    });

    it("should throw error when blob validation fails", () => {
      // Test blob validation failure scenarios
    });
  });

  describe("fetchGetBlobsV1AndBuildSidecars", () => {
    it("should build blob sidecars from execution engine response", () => {
      // Test successful sidecar building from execution engine blobs
    });

    it("should return empty array when execution engine returns no blobs", () => {
      // Test when execution engine returns empty response
    });

    it("should handle partial blob response from execution engine", () => {
      // Test when execution engine returns some but not all requested blobs
    });

    it("should correctly compute inclusion proofs for blob sidecars", () => {
      // Test inclusion proof computation
    });

    it("should handle execution engine errors gracefully", () => {
      // Test execution engine failure scenarios
    });
  });

  describe("fetchBlobByRoot", () => {
    it("should fetch blob sidecars by root from network", () => {
      // Test successful network blob fetch
    });

    it("should filter out blobs already in possession", () => {
      // Test that only missing blobs are requested
    });

    it("should handle empty blob request when all blobs are in possession", () => {
      // Test when indicesInPossession includes all needed blobs
    });

    it("should handle network request failure", () => {
      // Test network failure scenarios
    });
  });

  describe("validateBlobs", () => {
    it("should successfully validate all blob sidecars", () => {
      // Test successful blob validation
    });

    it("should throw error for extra unrequested blob sidecar", () => {
      // Test EXTRA_SIDECAR_RECEIVED error
    });

    it("should throw error for mismatched block root in blob header", () => {
      // Test MISMATCH_BLOCK_ROOT error for blob sidecar
    });

    it("should throw error for invalid inclusion proof", () => {
      // Test INVALID_INCLUSION_PROOF error
    });

    it("should throw error for invalid KZG proof", () => {
      // Test INVALID_KZG_PROOF error
    });

    it("should validate multiple blob sidecars correctly", () => {
      // Test validation of multiple blobs
    });
  });

  describe("fetchGetBlobsV2AndBuildSidecars", () => {
    it("should build column sidecars from execution engine blobs", () => {
      // Test successful column sidecar building
    });

    it("should return empty array when execution engine returns no response", () => {
      // Test when execution engine returns null/undefined
    });

    it("should handle execution engine errors", () => {
      // Test execution engine failure scenarios
    });

    it("should correctly process cells and proofs", () => {
      // Test getCellsAndProofs processing
    });
  });

  describe("fetchColumnsByRoot", () => {
    it("should fetch column sidecars by root from network", () => {
      // Test successful network column fetch
    });

    it("should handle network request failure", () => {
      // Test network failure scenarios
    });

    it("should request correct column indices", () => {
      // Test that correct missing columns are requested
    });
  });

  // describe("validateColumnSidecar", () => {
  //   it("should successfully validate column sidecar", () => {
  //     const columnSidecar = fuluBlockWithColumns.columnSidecars[0];
  //     const testBlockRoot = fuluBlockWithColumns.blockRoot;

  //     // This should not throw
  //     expect(() => {
  //       validateColumnSidecar({
  //         config,
  //         peerIdStr,
  //         blockRoot: testBlockRoot,
  //         columnSidecar,
  //       });
  //     }).not.toThrow();
  //   });

  //   it("should throw error for mismatched block root in column header", () => {
  //     const columnSidecar = fuluBlockWithColumns.columnSidecars[0];
  //     const wrongBlockRoot = new Uint8Array(32).fill(1); // Different block root

  //     expect(() => {
  //       validateColumnSidecar({
  //         config,
  //         peerIdStr,
  //         blockRoot: wrongBlockRoot,
  //         columnSidecar,
  //       });
  //     }).toThrow(DownloadByRootError);

  //     try {
  //       validateColumnSidecar({
  //         config,
  //         peerIdStr,
  //         blockRoot: wrongBlockRoot,
  //         columnSidecar,
  //       });
  //     } catch (error) {
  //       expect(error).toBeInstanceOf(DownloadByRootError);
  //       expect((error as DownloadByRootError).type.code).toBe(DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT);
  //       expect((error as DownloadByRootError).type.peer).toBe(peerIdStr);
  //       expect((error as DownloadByRootError).type.requestedBlockRoot).toBe(prettyBytes(wrongBlockRoot));
  //     }
  //   });

  //   it("should throw error for invalid inclusion proof", () => {
  //     const columnSidecar = ssz.fulu.DataColumnSidecar.clone(fuluBlockWithColumns.columnSidecars[0]);
  //     // Corrupt the inclusion proof to make it invalid
  //     columnSidecar.kzgCommitmentsInclusionProof[0] = new Uint8Array(32).fill(255);

  //     expect(() => {
  //       validateColumnSidecar({
  //         config,
  //         peerIdStr,
  //         blockRoot: fuluBlockWithColumns.blockRoot,
  //         columnSidecar,
  //       });
  //     }).toThrow(DownloadByRootError);

  //     try {
  //       validateColumnSidecar({
  //         config,
  //         peerIdStr,
  //         blockRoot: fuluBlockWithColumns.blockRoot,
  //         columnSidecar,
  //       });
  //     } catch (error) {
  //       expect(error).toBeInstanceOf(DownloadByRootError);
  //       expect((error as DownloadByRootError).type.code).toBe(DownloadByRootErrorCode.INVALID_INCLUSION_PROOF);
  //       expect((error as DownloadByRootError).type.peer).toBe(peerIdStr);
  //       expect((error as DownloadByRootError).type.blockRoot).toBe(prettyBytes(fuluBlockWithColumns.blockRoot));
  //       expect((error as DownloadByRootError).type.sidecarIndex).toBe(columnSidecar.index);
  //     }
  //   });
  // });

  describe("validateColumnSidecars", () => {
    it("should successfully validate all needed column sidecars", () => {
      // Test successful validation of needed columns
    });

    it("should successfully validate needed and publish columns", () => {
      // Test validation with both needed and needToPublish columns
    });

    it("should throw error for extra unrequested column sidecar", () => {
      // Test EXTRA_SIDECAR_RECEIVED error for columns
    });

    it("should throw error for invalid KZG proofs", () => {
      // Test INVALID_KZG_PROOF error for columns
    });

    it("should validate individual column sidecars correctly", () => {
      // Test individual column validation within the batch
    });

    it("should handle empty needToPublish array", () => {
      // Test when needToPublish is empty or not provided
    });

    it("should avoid duplicate validation for columns in both arrays", () => {
      // Test that columns present in both needed and needToPublish are not validated twice
    });
  });

  describe("fetchAndValidateColumns", () => {
    it("should fetch columns from execution engine and validate", () => {
      // Test successful fetch from execution engine
    });

    it("should fetch columns from network when execution engine returns empty", () => {
      // Test fallback to network when execution engine fails
    });

    it("should publish reconstructed columns to network", () => {
      // Test column publishing after reconstruction
    });

    it("should filter needed columns from reconstructed set", () => {
      // Test that only needed columns are returned
    });

    it("should handle publishing errors gracefully", () => {
      // Test that publishing errors don't fail the main operation
    });

    it("should validate columns correctly in both scenarios", () => {
      // Test validation works for both execution engine and network paths
    });

    it("should determine correct columns to publish based on custody config", () => {
      // Test needToPublish logic with custody configuration
    });
  });

  describe("DownloadByRootError", () => {
    it("should create error with MISMATCH_BLOCK_ROOT code", () => {
      const error = new DownloadByRootError({
        code: DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT,
        peer: peerIdStr,
        requestedBlockRoot: prettyBytes(blockRoot),
        receivedBlockRoot: prettyBytes(new Uint8Array(32).fill(1)),
      });

      expect(error).toBeInstanceOf(DownloadByRootError);
      expect(error.type.code).toBe(DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT);
      expect(error.type.peer).toBe(peerIdStr);
      expect(error.type.requestedBlockRoot).toBe(prettyBytes(blockRoot));
      expect(error.type.receivedBlockRoot).toBe(prettyBytes(new Uint8Array(32).fill(1)));
    });

    it("should create error with EXTRA_SIDECAR_RECEIVED code", () => {
      const error = new DownloadByRootError({
        code: DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED,
        peer: peerIdStr,
        blockRoot: prettyBytes(blockRoot),
        invalidIndex: 5,
      });

      expect(error).toBeInstanceOf(DownloadByRootError);
      expect(error.type.code).toBe(DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED);
      expect(error.type.peer).toBe(peerIdStr);
      expect(error.type.blockRoot).toBe(prettyBytes(blockRoot));
      expect(error.type.invalidIndex).toBe(5);
    });

    it("should create error with INVALID_INCLUSION_PROOF code", () => {
      const error = new DownloadByRootError({
        code: DownloadByRootErrorCode.INVALID_INCLUSION_PROOF,
        peer: peerIdStr,
        blockRoot: prettyBytes(blockRoot),
        sidecarIndex: 2,
      });

      expect(error).toBeInstanceOf(DownloadByRootError);
      expect(error.type.code).toBe(DownloadByRootErrorCode.INVALID_INCLUSION_PROOF);
      expect(error.type.peer).toBe(peerIdStr);
      expect(error.type.blockRoot).toBe(prettyBytes(blockRoot));
      expect(error.type.sidecarIndex).toBe(2);
    });

    it("should create error with INVALID_KZG_PROOF code", () => {
      const error = new DownloadByRootError({
        code: DownloadByRootErrorCode.INVALID_KZG_PROOF,
        peer: peerIdStr,
        blockRoot: prettyBytes(blockRoot),
      });

      expect(error).toBeInstanceOf(DownloadByRootError);
      expect(error.type.code).toBe(DownloadByRootErrorCode.INVALID_KZG_PROOF);
      expect(error.type.peer).toBe(peerIdStr);
      expect(error.type.blockRoot).toBe(prettyBytes(blockRoot));
    });

    it("should create error with MISSING_BLOCK_RESPONSE code", () => {
      const error = new DownloadByRootError({
        code: DownloadByRootErrorCode.MISSING_BLOCK_RESPONSE,
        peer: peerIdStr,
        blockRoot: prettyBytes(blockRoot),
      });

      expect(error).toBeInstanceOf(DownloadByRootError);
      expect(error.type.code).toBe(DownloadByRootErrorCode.MISSING_BLOCK_RESPONSE);
      expect(error.type.peer).toBe(peerIdStr);
      expect(error.type.blockRoot).toBe(prettyBytes(blockRoot));
    });

    it("should create error with MISSING_BLOB_RESPONSE code", () => {
      const error = new DownloadByRootError({
        code: DownloadByRootErrorCode.MISSING_BLOB_RESPONSE,
        peer: peerIdStr,
        blockRoot: prettyBytes(blockRoot),
      });

      expect(error).toBeInstanceOf(DownloadByRootError);
      expect(error.type.code).toBe(DownloadByRootErrorCode.MISSING_BLOB_RESPONSE);
      expect(error.type.peer).toBe(peerIdStr);
      expect(error.type.blockRoot).toBe(prettyBytes(blockRoot));
    });

    it("should create error with MISSING_COLUMN_RESPONSE code", () => {
      const error = new DownloadByRootError({
        code: DownloadByRootErrorCode.MISSING_COLUMN_RESPONSE,
        peer: peerIdStr,
        blockRoot: prettyBytes(blockRoot),
      });

      expect(error).toBeInstanceOf(DownloadByRootError);
      expect(error.type.code).toBe(DownloadByRootErrorCode.MISSING_COLUMN_RESPONSE);
      expect(error.type.peer).toBe(peerIdStr);
      expect(error.type.blockRoot).toBe(prettyBytes(blockRoot));
    });

    it("should include correct error details in error object", () => {
      const errorData = {
        code: DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT,
        peer: peerIdStr,
        requestedBlockRoot: prettyBytes(blockRoot),
        receivedBlockRoot: prettyBytes(new Uint8Array(32).fill(1)),
      };
      const error = new DownloadByRootError(errorData);

      expect(error.type).toEqual(errorData);
      expect(Object.keys(error.type)).toEqual(Object.keys(errorData));
    });
  });
});
