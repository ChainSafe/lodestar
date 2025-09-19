import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import {BlobSidecarValidationError} from "../../../../src/chain/errors/blobSidecarError.js";
import {validateBlockBlobSidecars} from "../../../../src/chain/validation/blobSidecar.js";
import {generateBlockWithBlobSidecars} from "../../../utils/blocksAndData.js";

describe("validateBlockBlobSidecars", () => {
  const {block, blockRoot, blobSidecars} = generateBlockWithBlobSidecars({forkName: ForkName.deneb});

  it("should validate correct blob sidecars", async () => {
    await expect(
      validateBlockBlobSidecars(
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        blobSidecars
      )
    ).resolves.toBeUndefined();
  });

  it("should error on no blobs in block", async () => {
    await expect(validateBlockBlobSidecars(block.message.slot, blockRoot, 0, blobSidecars)).rejects.toThrow(
      BlobSidecarValidationError
    );
  });

  it("should error if sidecar block header doesn't match block", async () => {
    const invalidSidecar = ssz.deneb.BlobSidecar.clone(blobSidecars[0]);
    invalidSidecar.signedBlockHeader.message.slot += 1; // invalid slot (will change the root)

    await expect(
      validateBlockBlobSidecars(block.message.slot, blockRoot, block.message.body.blobKzgCommitments.length, [
        invalidSidecar,
      ])
    ).rejects.toThrow(BlobSidecarValidationError);
  });

  it("should error on invalid index", async () => {
    const invalidSidecar = ssz.deneb.BlobSidecar.clone(blobSidecars[0]);
    invalidSidecar.index = block.message.body.blobKzgCommitments.length; // invalid index

    await expect(
      validateBlockBlobSidecars(block.message.slot, blockRoot, block.message.body.blobKzgCommitments.length, [
        invalidSidecar,
      ])
    ).rejects.toThrow(BlobSidecarValidationError);
  });

  it("should error on invalid kzg commitment", async () => {
    const invalidSidecar = ssz.deneb.BlobSidecar.clone(blobSidecars[0]);
    invalidSidecar.kzgCommitment = invalidSidecar.kzgCommitment.map((b) => b ^ 1); // invalid commitment

    await expect(
      validateBlockBlobSidecars(block.message.slot, blockRoot, block.message.body.blobKzgCommitments.length, [
        invalidSidecar,
      ])
    ).rejects.toThrow(BlobSidecarValidationError);
  });

  it("should error on invalid kzg commitment inclusion proof", async () => {
    const invalidSidecar = ssz.deneb.BlobSidecar.clone(blobSidecars[0]);
    invalidSidecar.kzgCommitmentInclusionProof[0][0] ^= 1; // invalid inclusion proof

    await expect(
      validateBlockBlobSidecars(block.message.slot, blockRoot, block.message.body.blobKzgCommitments.length, [
        invalidSidecar,
      ])
    ).rejects.toThrow(BlobSidecarValidationError);
  });

  it("should error on invalid kzg proof", async () => {
    const invalidSidecar = ssz.deneb.BlobSidecar.clone(blobSidecars[0]);
    invalidSidecar.kzgProof = invalidSidecar.kzgProof.map((b) => b ^ 1); // invalid proof

    await expect(
      validateBlockBlobSidecars(block.message.slot, blockRoot, block.message.body.blobKzgCommitments.length, [
        invalidSidecar,
      ])
    ).rejects.toThrow(BlobSidecarValidationError);
  });
});
