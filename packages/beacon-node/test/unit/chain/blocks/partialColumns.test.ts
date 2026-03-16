import {BitArray} from "@chainsafe/ssz";
import {describe, expect, it} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {computeStartSlotAtEpoch, signedBlockToSignedHeader} from "@lodestar/state-transition";
import {fulu, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  BlockInputColumns,
  BlockInputSource,
  DAType,
} from "../../../../src/chain/blocks/blockInput/index.js";

const FULU_FORK_EPOCH = 3;
const config = createChainForkConfig({
  ...defaultChainConfig,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 1,
  ELECTRA_FORK_EPOCH: 2,
  FULU_FORK_EPOCH,
  GLOAS_FORK_EPOCH: 4,
});

const fuluSlot = computeStartSlotAtEpoch(FULU_FORK_EPOCH);

function buildPartialHeaderTestData(blobCount: number): {
  header: fulu.PartialDataColumnHeader;
  blockRootHex: string;
} {
  const block = ssz.fulu.SignedBeaconBlock.defaultValue();
  block.message.slot = fuluSlot;

  // Add fake KZG commitments
  const commitments = Array.from({length: blobCount}, (_, i) => {
    const c = new Uint8Array(48);
    c[0] = i;
    return c;
  });
  block.message.body.blobKzgCommitments = commitments;

  const blockRoot = ssz.fulu.BeaconBlock.hashTreeRoot(block.message);
  const blockRootHex = toRootHex(blockRoot);
  const signedBlockHeader = signedBlockToSignedHeader(config, block);

  // Build a minimal inclusion proof (won't pass real verification, but sufficient for unit tests)
  const kzgCommitmentsInclusionProof = Array.from({length: 4}, () => new Uint8Array(32));

  const header: fulu.PartialDataColumnHeader = {
    kzgCommitments: commitments,
    signedBlockHeader,
    kzgCommitmentsInclusionProof,
  };

  return {header, blockRootHex};
}

function makeCellAndProof(blobIdx: number, columnIdx: number): {cell: Uint8Array; proof: Uint8Array} {
  const cell = new Uint8Array(2048);
  cell[0] = blobIdx;
  cell[1] = columnIdx;
  const proof = new Uint8Array(48);
  proof[0] = blobIdx;
  proof[1] = columnIdx;
  return {cell, proof};
}

describe("BlockInputColumns partial column support", () => {
  const blobCount = 3;
  const sampledColumns = [0, 1, 2, 3];
  const custodyColumns = [0, 1];

  describe("addPartialHeader", () => {
    it("should add and retrieve a partial header", () => {
      const {header, blockRootHex} = buildPartialHeaderTestData(blobCount);

      const blockInput = BlockInputColumns.createFromPartialHeader({
        blockRootHex,
        partialHeader: header,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
        peerIdStr: "test-peer",
        forkName: ForkName.fulu,
        daOutOfRange: false,
        sampledColumns,
        custodyColumns,
      });

      expect(blockInput.hasPartialHeader()).toBe(true);
      expect(blockInput.getPartialHeader()).toEqual(header);
    });

    it("should no-op when adding same header twice", () => {
      const {header, blockRootHex} = buildPartialHeaderTestData(blobCount);

      const blockInput = BlockInputColumns.createFromPartialHeader({
        blockRootHex,
        partialHeader: header,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
        peerIdStr: "test-peer",
        forkName: ForkName.fulu,
        daOutOfRange: false,
        sampledColumns,
        custodyColumns,
      });

      // Should not throw
      blockInput.addPartialHeader(header);
      expect(blockInput.hasPartialHeader()).toBe(true);
    });

    it("should throw when adding a different header", () => {
      const {header, blockRootHex} = buildPartialHeaderTestData(blobCount);

      const blockInput = BlockInputColumns.createFromPartialHeader({
        blockRootHex,
        partialHeader: header,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
        peerIdStr: "test-peer",
        forkName: ForkName.fulu,
        daOutOfRange: false,
        sampledColumns,
        custodyColumns,
      });

      // Create a different header (different slot -> different hash)
      const {header: differentHeader} = buildPartialHeaderTestData(blobCount + 1);

      expect(() => blockInput.addPartialHeader(differentHeader)).toThrow(
        "PartialDataColumnHeader does not match"
      );
    });
  });

  describe("createFromPartialHeader", () => {
    it("should create BlockInputColumns with correct properties", () => {
      const {header, blockRootHex} = buildPartialHeaderTestData(blobCount);

      const blockInput = BlockInputColumns.createFromPartialHeader({
        blockRootHex,
        partialHeader: header,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
        peerIdStr: "test-peer",
        forkName: ForkName.fulu,
        daOutOfRange: false,
        sampledColumns,
        custodyColumns,
      });

      expect(blockInput.type).toBe(DAType.Columns);
      expect(blockInput.blockRootHex).toBe(blockRootHex);
      expect(blockInput.slot).toBe(fuluSlot);
      expect(blockInput.hasBlock()).toBe(false);
      expect(blockInput.hasPartialHeader()).toBe(true);
    });
  });

  describe("addCells", () => {
    it("should accumulate cells and return null when incomplete", () => {
      const {header, blockRootHex} = buildPartialHeaderTestData(blobCount);
      const columnIndex = 5;

      const blockInput = BlockInputColumns.createFromPartialHeader({
        blockRootHex,
        partialHeader: header,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
        peerIdStr: "test-peer",
        forkName: ForkName.fulu,
        daOutOfRange: false,
        sampledColumns,
        custodyColumns,
      });

      // Add only the first cell (out of blobCount=3)
      const {cell, proof} = makeCellAndProof(0, columnIndex);
      const bitmap = [true, false, false]; // only first cell

      const result = blockInput.addCells(
        columnIndex,
        bitmap,
        [cell],
        [proof],
        BlockInputSource.gossip,
        Date.now() / 1000,
        "test-peer"
      );

      expect(result).toBeNull();
      expect(blockInput.getCellCount(columnIndex)).toBe(1);
      expect(blockInput.hasColumn(columnIndex)).toBe(false);
    });

    it("should return completed DataColumnSidecar when all cells arrive", () => {
      const {header, blockRootHex} = buildPartialHeaderTestData(blobCount);
      const columnIndex = 5;

      const blockInput = BlockInputColumns.createFromPartialHeader({
        blockRootHex,
        partialHeader: header,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
        peerIdStr: "test-peer",
        forkName: ForkName.fulu,
        daOutOfRange: false,
        sampledColumns,
        custodyColumns,
      });

      // Add all cells at once
      const cells: Uint8Array[] = [];
      const proofs: Uint8Array[] = [];
      for (let i = 0; i < blobCount; i++) {
        const {cell, proof} = makeCellAndProof(i, columnIndex);
        cells.push(cell);
        proofs.push(proof);
      }
      const bitmap = Array.from({length: blobCount}, () => true);

      const result = blockInput.addCells(
        columnIndex,
        bitmap,
        cells,
        proofs,
        BlockInputSource.gossip,
        Date.now() / 1000,
        "test-peer"
      );

      expect(result).not.toBeNull();
      expect(result!.index).toBe(columnIndex);
      expect(result!.column.length).toBe(blobCount);
      expect(result!.kzgProofs.length).toBe(blobCount);
      expect(result!.kzgCommitments).toEqual(header.kzgCommitments);
      expect(result!.signedBlockHeader).toEqual(header.signedBlockHeader);

      // Column should now be in columnsCache
      expect(blockInput.hasColumn(columnIndex)).toBe(true);
      expect(blockInput.getCellCount(columnIndex)).toBe(0); // cellsCache cleared
    });

    it("should complete column from multiple partial additions", () => {
      const {header, blockRootHex} = buildPartialHeaderTestData(blobCount);
      const columnIndex = 7;

      const blockInput = BlockInputColumns.createFromPartialHeader({
        blockRootHex,
        partialHeader: header,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
        peerIdStr: "test-peer",
        forkName: ForkName.fulu,
        daOutOfRange: false,
        sampledColumns,
        custodyColumns,
      });

      // First batch: cells 0 and 2
      const {cell: cell0, proof: proof0} = makeCellAndProof(0, columnIndex);
      const {cell: cell2, proof: proof2} = makeCellAndProof(2, columnIndex);
      const bitmap1 = [true, false, true];

      const result1 = blockInput.addCells(
        columnIndex,
        bitmap1,
        [cell0, cell2],
        [proof0, proof2],
        BlockInputSource.gossip,
        Date.now() / 1000,
        "test-peer"
      );

      expect(result1).toBeNull();
      expect(blockInput.getCellCount(columnIndex)).toBe(2);

      // Second batch: cell 1 (the missing one)
      const {cell: cell1, proof: proof1} = makeCellAndProof(1, columnIndex);
      const bitmap2 = [false, true, false];

      const result2 = blockInput.addCells(
        columnIndex,
        bitmap2,
        [cell1],
        [proof1],
        BlockInputSource.gossip,
        Date.now() / 1000,
        "test-peer"
      );

      expect(result2).not.toBeNull();
      expect(result2!.column.length).toBe(blobCount);
      expect(blockInput.hasColumn(columnIndex)).toBe(true);
    });

    it("should return null for already-complete column", () => {
      const {header, blockRootHex} = buildPartialHeaderTestData(blobCount);
      const columnIndex = 0;

      const blockInput = BlockInputColumns.createFromPartialHeader({
        blockRootHex,
        partialHeader: header,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
        peerIdStr: "test-peer",
        forkName: ForkName.fulu,
        daOutOfRange: false,
        sampledColumns,
        custodyColumns,
      });

      // Complete the column first
      const cells: Uint8Array[] = [];
      const proofs: Uint8Array[] = [];
      for (let i = 0; i < blobCount; i++) {
        const {cell, proof} = makeCellAndProof(i, columnIndex);
        cells.push(cell);
        proofs.push(proof);
      }
      const bitmap = Array.from({length: blobCount}, () => true);

      blockInput.addCells(columnIndex, bitmap, cells, proofs, BlockInputSource.gossip, Date.now() / 1000, "test-peer");

      // Try adding again
      const result = blockInput.addCells(
        columnIndex,
        bitmap,
        cells,
        proofs,
        BlockInputSource.gossip,
        Date.now() / 1000,
        "test-peer"
      );

      expect(result).toBeNull();
    });

    it("should throw without a partial header", () => {
      const {blockRootHex} = buildPartialHeaderTestData(blobCount);

      // Create from column (no partial header)
      const columnSidecar = ssz.fulu.DataColumnSidecar.defaultValue();
      columnSidecar.signedBlockHeader.message.slot = fuluSlot;

      const blockInput = BlockInputColumns.createFromColumn({
        blockRootHex,
        columnSidecar,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
        peerIdStr: "test-peer",
        forkName: ForkName.fulu,
        daOutOfRange: false,
        sampledColumns,
        custodyColumns,
      });

      expect(() =>
        blockInput.addCells(0, [true], [new Uint8Array(2048)], [new Uint8Array(48)], BlockInputSource.gossip, 0, "peer")
      ).toThrow("Cannot addCells without a stored PartialDataColumnHeader");
    });
  });
});
