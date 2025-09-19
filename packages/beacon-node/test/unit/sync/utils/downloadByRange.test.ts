import {beforeEach, describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {BlockInputPreData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "../../../../src/chain/blocks/blockInput/types.js";
import {ValidatedBlock, getBlocksForDataValidation} from "../../../../src/sync/utils/downloadByRange.js";
import {generateChainOfBlockMaybeSidecars} from "../../../utils/blocksAndData.js";

/**
 * Logic errors and gaps identified during test case creation:
 *
 * INSERT_LOGIC_ERROR_BULLET_POINTS_HERE
 *
 * - validateBlockByRangeResponse: Commented out zero blocks check breaks during chain liveness issues (line 445-453)
 * - validateBlobsByRangeResponse: Missing validation that blob sidecars are in consecutive (slot, index) order as per spec
 * - validateColumnsByRangeResponse: Missing validation that column sidecars are in consecutive (slot, index) order
 * - cacheByRangeResponses: Error handling for wrong chain only breaks loop but doesn't throw/propagate error properly
 * - getBlocksForDataValidation: No validation that cached blocks are actually before current blocks as assumed in comments
 * - validateResponses: Missing validation that blocks and data requests have matching/compatible slot ranges
 * - downloadByRange: Original error details are lost when catching and re-throwing REQ_RESP_ERROR
 * - validateBlobsByRangeResponse: Doesn't validate blob indices are sequential (0, 1, 2...) within each block
 * - validateColumnsByRangeResponse: Logic assumes all requested columns present but doesn't validate properly
 * - cacheByRangeResponses: Type checking for DAType mismatch happens after attempting operations
 * - validateBlockByRangeResponse: Parent root validation only checks consecutive blocks, missing skip slot handling
 * - requestByRange: No timeout handling for concurrent network requests
 * - validateResponses: batchBlocks parameter can be undefined but not properly handled in all cases
 */

// describe("downloadByRange", () => {
// const peerIdStr = "0x1234567890abcdef";
// // let cache: SeenBlockInputCache;
// let network: INetwork;
// // const logger = getMockedLogger();

// const startSlot = slots.deneb;
// const count = 32;
// let requests!: DownloadByRangeRequests;
// let networkResponse!: {
//   blocks: WithBytes<SignedBeaconBlock>[];
//   blobSidecars: deneb.BlobSidecars;
//   columnSidecars: fulu.DataColumnSidecars;
// };
// let expected!: DownloadByRangeResponses;

// beforeAll(() => {
//   // Test setup code here
// });

// describe("cacheByRangeResponses", () => {
//   it("should cache blocks only when no data sidecars present");
//   it("should cache blocks with blob sidecars");
//   it("should cache blocks with column sidecars");
//   it("should add blocks to existing batch blocks");
//   it("should add blob sidecars to existing batch blocks");
//   it("should add column sidecars to existing batch blocks");
//   it("should create new block input when block doesn't exist in batch");
//   it("should create new block input from blob sidecars when block doesn't exist");
//   it("should create new block input from column sidecars when block doesn't exist");
//   it("should throw error when block input type mismatches for blobs");
//   it("should throw error when block input type mismatches for columns");
//   it("should handle wrong chain error for blocks in finalized sync");
//   it("should handle wrong chain error for blobs in finalized sync");
//   it("should handle wrong chain error for columns in finalized sync");
//   it("should not report peer for wrong chain in non-finalized sync");
//   it("should maintain slot ordering in returned block inputs");
//   it("should handle empty responses gracefully");
//   it("should handle duplicate blocks with throwOnDuplicateAdd false");
//   it("should handle duplicate blobs with throwOnDuplicateAdd false");
//   it("should handle duplicate columns with throwOnDuplicateAdd false");
// });

// describe("downloadByRange", () => {
//   it("should download and validate blocks only");
//   it("should download and validate blocks with blobs");
//   it("should download and validate blocks with columns");
//   it("should download blocks, blobs and columns concurrently");
//   it("should use cached batch blocks for data validation when no blocks request");
//   it("should throw REQ_RESP_ERROR when network request fails");
//   it("should handle empty responses from network");
//   it("should validate responses before returning");
//   it("should pass through validation errors");
//   it("should log verbose error before throwing");
// });

// describe("requestByRange", () => {
//   it("should make block requests");
//   it("should make blob requests");
//   it("should make column requests");
//   it("should make concurrent block/blob/column requests from the same peer");
//   it("should handle undefined responses properly");
//   it("should throw if one of the concurrent requests fails");
//   it("should not make requests for undefined request parameters");
//   it("should return empty object when no requests provided");
//   it("should handle network timeout errors");
//   it("should preserve response order for concurrent requests");
// });

// describe("validateResponses", () => {
//   it("should validate blocks when blocksRequest provided");
//   it("should validate blobs when blobsRequest provided with blocks");
//   it("should validate columns when columnsRequest provided with blocks");
//   it("should use batchBlocks for data validation when no blocksRequest");
//   it("should throw MISSING_BLOCKS when data request but no blocks available");
//   it("should throw MISSING_BLOBS_RESPONSE when blobsRequest but no blobSidecars");
//   it("should throw MISSING_COLUMNS_RESPONSE when columnsRequest but no columnSidecars");
//   it("should return empty responses when no requests provided");
//   it("should validate blocks before validating data sidecars");
//   it("should use validated blocks for data validation when both downloaded");
//   it("should handle mixed cached and downloaded blocks for validation");
//   it("should validate slot ranges match between blocks and data requests");
// });

// describe("validateBlockByRangeResponse", () => {
//   it("should accept valid chain of blocks");
//   it("should accept empty response during chain liveness issues");
//   it("should throw EXTRA_BLOCKS when more blocks than requested count");
//   it("should throw OUT_OF_RANGE_BLOCKS when block slot before startSlot");
//   it("should throw OUT_OF_RANGE_BLOCKS when block slot after lastValidSlot");
//   it("should throw OUT_OF_ORDER_BLOCKS when blocks not in ascending slot order");
//   it("should allow skip slots in block chain");
//   it("should validate parent root matches previous block root");
//   it("should throw PARENT_ROOT_MISMATCH when chain broken");
//   it("should handle single block response");
//   it("should handle maximum count blocks");
//   it("should compute block roots correctly for each fork");
//   it("should validate blocks at fork boundaries");
//   it("should handle blocks with same slot (reorgs)");
// });

// describe("validateBlobsByRangeResponse", () => {
//   it("should accept valid blob sidecars matching blocks");
//   it("should throw EXTRA_BLOBS when more blobs than expected");
//   it("should throw MISSING_BLOBS when fewer blobs than expected");
//   it("should validate blob count matches block kzg commitments");
//   it("should skip blocks with zero kzg commitments");
//   it("should validate blobs in consecutive (slot, index) order");
//   it("should validate blob indices are sequential within block");
//   it("should validate all blobs for a block are included");
//   it("should call validateBlockBlobSidecars for each block with blobs");
//   it("should handle blocks with different blob counts");
//   it("should validate blobs across multiple blocks");
//   it("should return validated blob sidecars grouped by block");
//   it("should handle maximum blob count per block");
//   it("should validate blob sidecars in parallel");
//   it("should propagate validation errors from validateBlockBlobSidecars");
// });

// describe("validateColumnsByRangeResponse", () => {
//   it("should accept valid column sidecars matching blocks");
//   it("should throw EXTRA_COLUMNS when more columns than expected");
//   it("should throw MISSING_COLUMNS when fewer columns than expected");
//   it("should validate column count matches requested columns times blocks with commitments");
//   it("should skip blocks with zero kzg commitments");
//   it("should validate columns in consecutive (slot, index) order");
//   it("should validate all requested column indices present for each block");
//   it("should validate column indices match requested columns array");
//   it("should validate columns are in order within each block");
//   it("should throw MISSING_COLUMNS when columns not in correct order");
//   it("should call validateBlockDataColumnSidecars for each block with columns");
//   it("should handle blocks with different commitment counts");
//   it("should validate columns across multiple blocks");
//   it("should return validated column sidecars grouped by block");
//   it("should handle partial column requests (subset of indices)");
//   it("should validate column sidecars in parallel");
//   it("should propagate validation errors from validateBlockDataColumnSidecars");
// });

describe("getBlocksForDataValidation", () => {
  const forkName = ForkName.capella;
  let chainOfBlocks: ReturnType<typeof generateChainOfBlockMaybeSidecars>;
  let blockInputs: IBlockInput[];
  let validatedBlocks: ValidatedBlock[];

  beforeEach(() => {
    chainOfBlocks = generateChainOfBlockMaybeSidecars({forkName, count: 32, oomProtection: true});
    blockInputs = chainOfBlocks.map(({block, rootHex}) =>
      BlockInputPreData.createFromBlock({
        block,
        forkName,
        blockRootHex: rootHex,
        daOutOfRange: true,
        seenTimestampSec: Date.now(),
        source: BlockInputSource.gossip,
      })
    );
    validatedBlocks = chainOfBlocks.map(({block, blockRoot}) => ({block, blockRoot}));
  });

  it("should return requested slot range from cached", () => {
    // Request slots 10-20 from cached blocks (slots 0-31)
    const dataRequest = {startSlot: 10, count: 10};
    const lastSlot = dataRequest.startSlot + dataRequest.count - 1;

    const result = getBlocksForDataValidation(dataRequest, blockInputs.slice(10, 20), undefined);

    expect(result).toHaveLength(10);
    expect(result[0].block.message.slot).toBe(dataRequest.startSlot);
    expect(result[dataRequest.count - 1].block.message.slot).toBe(lastSlot);
  });

  it("should filter out blocks before and after range from cached", () => {
    // Request slots 10-20 but provide cached blocks from slots 5-25
    const dataRequest = {startSlot: 10, count: 10};
    const lastSlot = dataRequest.startSlot + dataRequest.count - 1;
    const cached = blockInputs;

    const result = getBlocksForDataValidation(dataRequest, cached, undefined);

    expect(result).toHaveLength(10);
    expect(result[0].block.message.slot).toBe(dataRequest.startSlot);
    expect(result[dataRequest.count - 1].block.message.slot).toBe(lastSlot);
    // Verify no blocks outside range
    for (const block of result) {
      expect(block.block.message.slot).toBeGreaterThanOrEqual(10);
      expect(block.block.message.slot).toBeLessThan(20);
    }
  });

  it("should return requested slot range from current", () => {
    // Request slots 10-20 from current blocks (slots 0-31)
    const dataRequest = {startSlot: 10, count: 10};
    const lastSlot = dataRequest.startSlot + dataRequest.count - 1;
    const current = validatedBlocks.slice(10, 20);

    const result = getBlocksForDataValidation(dataRequest, undefined, current);

    expect(result).toHaveLength(10);
    expect(result[0].block.message.slot).toBe(dataRequest.startSlot);
    expect(result[dataRequest.count - 1].block.message.slot).toBe(lastSlot);
  });

  it("should filter out blocks before and after range from current", () => {
    // Request slots 10-20 but provide current blocks from slots 5-25
    const dataRequest = {startSlot: 10, count: 10};
    const lastSlot = dataRequest.startSlot + dataRequest.count - 1;
    const current = validatedBlocks;

    const result = getBlocksForDataValidation(dataRequest, undefined, current);

    expect(result).toHaveLength(10);
    expect(result[0].block.message.slot).toBe(dataRequest.startSlot);
    expect(result[dataRequest.count - 1].block.message.slot).toBe(lastSlot);
    // Verify no blocks outside range
    for (const block of result) {
      expect(block.block.message.slot).toBeGreaterThanOrEqual(10);
      expect(block.block.message.slot).toBeLessThan(20);
    }
  });

  it("should return requested slot range from combination of cached and current", () => {
    const dataRequest = {startSlot: 5, count: 25};
    const lastSlot = dataRequest.startSlot + dataRequest.count - 1;
    const cached = blockInputs.slice(0, 15);
    const current = validatedBlocks.slice(15);

    const result = getBlocksForDataValidation(dataRequest, cached, current);

    expect(result).toHaveLength(25);
    expect(result[0].block.message.slot).toBe(dataRequest.startSlot);

    expect(result[dataRequest.count - 1].block.message.slot).toBe(lastSlot);
  });

  it("should always return ValidatedBlocks for mixed block source", () => {
    const dataRequest = {startSlot: 5, count: 25};
    const cached = blockInputs.slice(0, 15);
    const current = validatedBlocks.slice(15);

    const result = getBlocksForDataValidation(dataRequest, cached, current);

    // All results should be ValidatedBlock type with block and blockRoot
    for (const validatedBlock of result) {
      expect(validatedBlock).toHaveProperty("block");
      expect(validatedBlock).toHaveProperty("blockRoot");
      expect(validatedBlock.blockRoot).toBeInstanceOf(Uint8Array);
    }
  });

  it("should maintain ascending slot order", () => {
    const dataRequest = {startSlot: 5, count: 25};
    const cached = blockInputs.slice(0, 15);
    const current = validatedBlocks.slice(15);

    const result = getBlocksForDataValidation(dataRequest, cached, current);

    expect(result.sort((a, b) => a.block.message.slot - b.block.message.slot)).toEqual(result);
  });

  it("should handle overlapping slot ranges between cached and current", () => {
    // Both cached and current have blocks for slots 12-15
    const dataRequest = {startSlot: 10, count: 10};
    const lastSlot = dataRequest.startSlot + dataRequest.count - 1;
    const cached = blockInputs.slice(0, 16); // slots 0-15
    const current = validatedBlocks.slice(12, 25); // slots 12-24

    const result = getBlocksForDataValidation(dataRequest, cached, current);

    // Should not have duplicates, cached takes precedence
    expect(result).toHaveLength(10);
    expect(result[0].block.message.slot).toBe(dataRequest.startSlot);
    expect(result[dataRequest.count - 1].block.message.slot).toBe(lastSlot);
    // Verify no duplicate slots
    const slots = result.map((b) => b.block.message.slot);
    const uniqueSlots = new Set(slots);
    expect(uniqueSlots.size).toBe(slots.length);
  });

  it("should return empty array when no blocks in range", () => {
    const dataRequest = {startSlot: 100, count: 10};
    const cached = blockInputs.slice(0, 10); // slots 0-9
    const current = validatedBlocks.slice(10, 20); // slots 10-19

    const result = getBlocksForDataValidation(dataRequest, cached, current);

    expect(result).toHaveLength(0);
  });

  it("should tolerate skip slots in cached and current", () => {
    const dataRequest = {startSlot: 0, count: 20};
    // Create sparse arrays with skip slots
    const cached = [blockInputs[1], blockInputs[3], blockInputs[5], blockInputs[7]];
    const current = [validatedBlocks[10], validatedBlocks[12], validatedBlocks[15], validatedBlocks[18]];

    const result = getBlocksForDataValidation(dataRequest, cached, current);

    expect(result).toHaveLength(cached.length + current.length);
    const slots = result.map(({block}) => block.message.slot);
    const expectedSlots = cached.map((b) => b.slot).concat(...current.map((b) => b.block.message.slot));
    expect(slots).toEqual(expectedSlots);

    // Verify ascending order is maintained despite skip slots
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]).toBeGreaterThan(slots[i - 1]);
    }
  });
});

// describe("Error handling", () => {
//   it("should build correct slot range string for blocks request");
//   it("should build correct slot range string for blobs request");
//   it("should build correct slot range string for columns request");
//   it("should handle missing request parameters in slot range string");
//   it("should create DownloadByRangeError with correct error codes");
//   it("should preserve error context in DownloadByRangeError");
//   it("should handle network errors appropriately");
//   it("should handle validation errors appropriately");
//   it("should handle cache errors appropriately");
// });

// describe("Integration scenarios", () => {
//   it("should handle full download and cache flow for blocks only");
//   it("should handle full download and cache flow for blocks with blobs");
//   it("should handle full download and cache flow for blocks with columns");
//   it("should handle partial responses within valid range");
//   it("should handle peer disconnection during download");
//   it("should handle fork transition during range download");
//   it("should handle reorg detection via parent root mismatch");
//   it("should handle maximum request size limits");
//   it("should handle minimum request size (count=1)");
//   it("should handle skip slots in epoch boundaries");
//   it("should handle genesis slot edge cases");
//   it("should handle far future slot requests");
// });
// });
