import {describe, expect, it} from "vitest";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {DataColumnSidecarValidationError} from "../../../../src/chain/errors/dataColumnSidecarError.js";
import {validateBlockDataColumnSidecars} from "../../../../src/chain/validation/dataColumnSidecar.js";
import {generateBlockWithColumnSidecars} from "../../../utils/blocksAndData.js";

describe("validateBlockDataColumnSidecars", () => {
  const {block, blockRoot, columnSidecars} = generateBlockWithColumnSidecars({forkName: ForkName.fulu});

  it("should validate correct column sidecars", async () => {
    await expect(
      validateBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        columnSidecars
      )
    ).resolves.toBeUndefined();
  });

  it("should validate empty sidecars array", async () => {
    await expect(
      validateBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        []
      )
    ).resolves.toBeUndefined();
  });

  it("should error on no blobs in block", async () => {
    await expect(
      validateBlockDataColumnSidecars(null, block.message.slot, blockRoot, 0, columnSidecars)
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error if sidecar block header doesn't match block", async () => {
    const invalidSidecar = ssz.fulu.DataColumnSidecar.clone(columnSidecars[0]);
    invalidSidecar.signedBlockHeader.message.slot += 1; // invalid slot (will change the root)

    await expect(
      validateBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        [invalidSidecar]
      )
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid column index", async () => {
    const invalidSidecar = ssz.fulu.DataColumnSidecar.clone(columnSidecars[0]);
    invalidSidecar.index = NUMBER_OF_COLUMNS; // invalid index

    await expect(
      validateBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        [invalidSidecar]
      )
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid kzg commitments", async () => {
    const invalidSidecar = ssz.fulu.DataColumnSidecar.clone(columnSidecars[0]);
    invalidSidecar.kzgCommitments = columnSidecars[0].kzgCommitments.map((commitment) => commitment.map((b) => b ^ 1)); // invalid commitments

    await expect(
      validateBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        [invalidSidecar]
      )
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid kzg commitments inclusion proofs", async () => {
    const invalidSidecar = ssz.fulu.DataColumnSidecar.clone(columnSidecars[0]);
    invalidSidecar.kzgCommitmentsInclusionProof[0][0] ^= 1; // invalid inclusion proof

    await expect(
      validateBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        [invalidSidecar]
      )
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid kzg proof", async () => {
    const invalidSidecar = ssz.fulu.DataColumnSidecar.clone(columnSidecars[0]);
    invalidSidecar.kzgProofs = columnSidecars[0].kzgProofs.map((proof) => proof.map((b) => b ^ 1)); // invalid proofs

    await expect(
      validateBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        [invalidSidecar]
      )
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });
});
