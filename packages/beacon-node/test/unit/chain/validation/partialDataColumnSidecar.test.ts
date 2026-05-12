import {BYTES_PER_BLOB} from "@crate-crypto/node-eth-kzg";
import {describe, expect, it} from "vitest";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {BitArray} from "@chainsafe/ssz";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {KZG_COMMITMENTS_GINDEX} from "@lodestar/params";
import {computeStartSlotAtEpoch, signedBlockToSignedHeader} from "@lodestar/state-transition";
import {fulu, ssz} from "@lodestar/types";
import {DataColumnSidecarErrorCode} from "../../../../src/chain/errors/dataColumnSidecarError.js";
import {GossipAction} from "../../../../src/chain/errors/gossipValidation.js";
import {
  validateGossipPartialDataColumnCells,
  verifyPartialDataColumnHeaderInclusionProof,
} from "../../../../src/chain/validation/partialDataColumnSidecar.js";
import {kzg} from "../../../../src/util/kzg.js";

const config = createChainForkConfig({
  ...defaultChainConfig,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  ELECTRA_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
  GLOAS_FORK_EPOCH: Infinity,
});
const fuluSlot = computeStartSlotAtEpoch(config.FULU_FORK_EPOCH);

function buildPartialHeader(columnSidecar: fulu.DataColumnSidecar): fulu.PartialDataColumnHeader {
  return {
    kzgCommitments: columnSidecar.kzgCommitments,
    signedBlockHeader: columnSidecar.signedBlockHeader,
    kzgCommitmentsInclusionProof: columnSidecar.kzgCommitmentsInclusionProof,
  };
}

function buildPartialSidecar(columnSidecar: fulu.DataColumnSidecar): fulu.PartialDataColumnSidecar {
  const partialSidecar = ssz.fulu.PartialDataColumnSidecar.defaultValue();
  partialSidecar.cellsPresentBitmap = BitArray.fromBoolArray(
    Array.from({length: columnSidecar.column.length}, () => true)
  );
  partialSidecar.partialColumn = columnSidecar.column;
  partialSidecar.kzgProofs = columnSidecar.kzgProofs;
  partialSidecar.header = [];
  return partialSidecar;
}

function buildColumnSidecarFixture(): fulu.DataColumnSidecar {
  const block = ssz.fulu.SignedBeaconBlock.defaultValue();
  block.message.slot = fuluSlot;

  const blobs = [new Uint8Array(BYTES_PER_BLOB), new Uint8Array(BYTES_PER_BLOB).fill(1)];
  const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
  block.message.body.blobKzgCommitments = kzgCommitments;

  const signedBlockHeader = signedBlockToSignedHeader(config, block);
  const bodyView = ssz.fulu.BeaconBlockBody.toView(block.message.body);
  const kzgCommitmentsInclusionProof = new Tree(bodyView.node).getSingleProof(BigInt(KZG_COMMITMENTS_GINDEX));
  const cellsAndProofs = blobs.map((blob) => kzg.computeCellsAndKzgProofs(blob));

  return {
    index: 0,
    column: cellsAndProofs.map(({cells}) => cells[0]),
    kzgCommitments,
    kzgProofs: cellsAndProofs.map(({proofs}) => proofs[0]),
    signedBlockHeader,
    kzgCommitmentsInclusionProof,
  };
}

describe("partialDataColumnSidecar validation", () => {
  const columnSidecar = buildColumnSidecarFixture();
  const header = buildPartialHeader(columnSidecar);
  const cellValidationContext = {
    slot: header.signedBlockHeader.message.slot,
    kzgCommitments: header.kzgCommitments,
  };
  const partialSidecar = buildPartialSidecar(columnSidecar);

  describe("verifyPartialDataColumnHeaderInclusionProof", () => {
    it("returns true for a valid inclusion proof", () => {
      expect(verifyPartialDataColumnHeaderInclusionProof(header)).toBe(true);
    });

    it("returns false for a tampered inclusion proof", () => {
      const tamperedHeader = ssz.fulu.PartialDataColumnHeader.clone(header);
      tamperedHeader.kzgCommitmentsInclusionProof[0][0] ^= 1;

      expect(verifyPartialDataColumnHeaderInclusionProof(tamperedHeader)).toBe(false);
    });
  });

  describe("validateGossipPartialDataColumnCells", () => {
    it("rejects when the bitmap length does not match the commitments count", async () => {
      const invalidSidecar = ssz.fulu.PartialDataColumnSidecar.clone(partialSidecar);
      invalidSidecar.cellsPresentBitmap = BitArray.fromBoolArray([true]);

      await expect(
        validateGossipPartialDataColumnCells(invalidSidecar, cellValidationContext, columnSidecar.index, null)
      ).rejects.toMatchObject({
        action: GossipAction.REJECT,
        type: {code: DataColumnSidecarErrorCode.PARTIAL_BITMAP_LENGTH_MISMATCH},
      });
    });

    it("rejects when the number of cells and proofs differs", async () => {
      const invalidSidecar = ssz.fulu.PartialDataColumnSidecar.clone(partialSidecar);
      invalidSidecar.kzgProofs = invalidSidecar.kzgProofs.slice(1);

      await expect(
        validateGossipPartialDataColumnCells(invalidSidecar, cellValidationContext, columnSidecar.index, null)
      ).rejects.toMatchObject({
        action: GossipAction.REJECT,
        type: {code: DataColumnSidecarErrorCode.PARTIAL_CELL_PROOF_COUNT_MISMATCH},
      });
    });

    it("rejects when the number of cells does not match the bitmap popcount", async () => {
      const invalidSidecar = ssz.fulu.PartialDataColumnSidecar.clone(partialSidecar);
      invalidSidecar.cellsPresentBitmap = BitArray.fromBoolArray([true, true]);
      invalidSidecar.partialColumn = invalidSidecar.partialColumn.slice(1);
      invalidSidecar.kzgProofs = invalidSidecar.kzgProofs.slice(1);

      await expect(
        validateGossipPartialDataColumnCells(invalidSidecar, cellValidationContext, columnSidecar.index, null)
      ).rejects.toMatchObject({
        action: GossipAction.REJECT,
        type: {code: DataColumnSidecarErrorCode.PARTIAL_CELL_PROOF_COUNT_MISMATCH},
      });
    });

    it("accepts valid cells, bitmap, and proofs", async () => {
      await expect(
        validateGossipPartialDataColumnCells(partialSidecar, cellValidationContext, columnSidecar.index, null)
      ).resolves.toBeUndefined();
    });
  });
});
