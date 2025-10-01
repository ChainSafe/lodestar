import {describe, expect, it} from "vitest";
import {deneb, fulu} from "@lodestar/types";
import {
  validateBlobsAndKzgCommitments,
  validateCellsAndKzgCommitments,
} from "../../../../src/chain/produceBlock/validateBlobsAndKzgCommitments.js";
import {kzg} from "../../../../src/util/kzg.js";
import {generateRandomBlob} from "../../../utils/kzg.js";

describe("validateBlobsAndKzgCommitments", () => {
  it("should validate a valid V1 blobs bundle", async () => {
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const commitments = [];
    const proofs = [];

    for (const blob of blobs) {
      const commitment = kzg.blobToKzgCommitment(blob);
      const proof = kzg.computeBlobKzgProof(blob, commitment);

      commitments.push(commitment);
      proofs.push(proof);
    }

    await expect(validateBlobsAndKzgCommitments(commitments, proofs, blobs)).resolves.toBeUndefined();
  });

  it("should throw if V1 blobs bundle proof verification fails", async () => {
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const commitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
    const proofs = blobs.map(() => new Uint8Array(48).fill(1)); // filled with all ones which should fail verification

    await expect(validateBlobsAndKzgCommitments(commitments, proofs, blobs)).rejects.toThrow();
  });

  it("should throw if commitments and blobs lengths don't match", async () => {
    const commitments = [new Uint8Array(48).fill(1)];
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const proofs: deneb.KZGProof[] = [];

    await expect(validateBlobsAndKzgCommitments(commitments, proofs, blobs)).rejects.toThrow(
      "Blobs bundle blobs len 2 != commitments len 1"
    );
  });

  it("should throw if V1 proofs length is incorrect", async () => {
    const blobs = [generateRandomBlob()];
    const commitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));

    const proofs: deneb.KZGProof[] = []; // No proofs when we need one per blob

    await expect(validateBlobsAndKzgCommitments(commitments, proofs, blobs)).rejects.toThrow(
      "Invalid proofs length for BlobsBundleV1 format: expected 1, got 0"
    );
  });

  it("should throw if V2 cell proofs verification fails", async () => {
    const blobs = [generateRandomBlob()];
    const commitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
    const cells = blobs.flatMap((blob) => kzg.computeCells(blob));
    const proofs = cells.map(() => new Uint8Array(48).fill(0)); // filled with all zeros which should fail verification

    await expect(validateBlobsAndKzgCommitments(commitments, proofs, blobs)).rejects.toThrow();
  });
});
describe("validateCellsAndKzgCommitments", () => {
  it("should validate BlobsBundleV2 when cells are passed", async () => {
    const blobs = [generateRandomBlob()];

    // Compute commitments, cells, and proofs for each blob
    const commitments: deneb.KZGCommitment[] = [];
    const cells: fulu.Cell[][] = [];
    const proofs: deneb.KZGProof[] = [];
    blobs.map((blob) => {
      commitments.push(kzg.blobToKzgCommitment(blob));

      const {cells: blobCells, proofs: blobProofs} = kzg.computeCellsAndKzgProofs(blob);
      cells.push(blobCells);
      proofs.push(...blobProofs);
    });

    await expect(validateCellsAndKzgCommitments(commitments, proofs, cells)).resolves.not.toThrow();
  });
});
