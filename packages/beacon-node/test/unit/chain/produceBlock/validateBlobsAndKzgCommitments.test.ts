import {CELLS_PER_EXT_BLOB, ForkName} from "@lodestar/params";
import {ExecutionPayload, deneb, fulu} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import {validateBlobsAndKzgCommitments} from "../../../../src/chain/produceBlock/validateBlobsAndKzgCommitments.js";
import {BlobsBundle} from "../../../../src/execution/index.js";
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

    const blobsBundle: BlobsBundle = {
      commitments,
      blobs,
      proofs,
    };

    // Create a mock ExecutionPayload
    const mockPayload = {
      blockNumber: 1,
      blockHash: new Uint8Array(32),
      parentHash: new Uint8Array(32),
    } as ExecutionPayload;

    await expect(validateBlobsAndKzgCommitments(ForkName.deneb, mockPayload, blobsBundle)).resolves.toBeUndefined();
  });

  it("should throw if V1 blobs bundle proof verification fails", async () => {
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const commitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
    const proofs = blobs.map(() => new Uint8Array(48).fill(1)); // filled with all ones which should fail verification

    const blobsBundle: BlobsBundle = {
      commitments,
      blobs,
      proofs,
    };

    // Create a mock ExecutionPayload
    const mockPayload = {
      blockNumber: 1,
      blockHash: new Uint8Array(32),
      parentHash: new Uint8Array(32),
    } as ExecutionPayload;

    await expect(validateBlobsAndKzgCommitments(ForkName.deneb, mockPayload, blobsBundle)).rejects.toThrow();
  });

  it("should throw if commitments and blobs lengths don't match", async () => {
    const blobsBundle: BlobsBundle = {
      commitments: [new Uint8Array(48).fill(1)],
      blobs: [generateRandomBlob(), generateRandomBlob()],
      proofs: [],
    };

    // Create a mock ExecutionPayload
    const mockPayload = {
      blockNumber: 1,
      blockHash: new Uint8Array(32),
      parentHash: new Uint8Array(32),
    } as ExecutionPayload;

    await expect(validateBlobsAndKzgCommitments(ForkName.deneb, mockPayload, blobsBundle)).rejects.toThrow(
      "Blobs bundle blobs len 2 != commitments len 1"
    );
  });

  it("should throw if V1 proofs length is incorrect", async () => {
    const blobs = [generateRandomBlob()];
    const commitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
    const blobsBundle: BlobsBundle = {
      commitments,
      blobs,
      proofs: [], // No proofs when we need one per blob
    };

    // Create a mock ExecutionPayload
    const mockPayload = {
      blockNumber: 1,
      blockHash: new Uint8Array(32),
      parentHash: new Uint8Array(32),
    } as ExecutionPayload;

    await expect(validateBlobsAndKzgCommitments(ForkName.deneb, mockPayload, blobsBundle)).rejects.toThrow(
      "Invalid proofs length for BlobsBundleV1 format: expected 1, got 0"
    );
  });

  it("should throw if V2 proofs length is incorrect", async () => {
    const blobs = [generateRandomBlob()];
    const commitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
    const blobsBundle: BlobsBundle = {
      commitments,
      blobs,
      proofs: [new Uint8Array(48).fill(1)], // Only one proof when we need CELLS_PER_EXT_BLOB
    };
    const cells = blobsBundle.blobs.map((blob) => kzg.computeCells(blob));

    // Create a mock ExecutionPayload
    const mockPayload = {
      blockNumber: 1,
      blockHash: new Uint8Array(32),
      parentHash: new Uint8Array(32),
    } as ExecutionPayload;

    await expect(validateBlobsAndKzgCommitments(ForkName.fulu, mockPayload, blobsBundle, cells)).rejects.toThrow(
      `Invalid proofs length for BlobsBundleV2 format: expected ${CELLS_PER_EXT_BLOB}, got 1`
    );
  });

  it("should throw if V2 cell proofs verification fails", async () => {
    const blobs = [generateRandomBlob()];
    const commitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
    const cells = blobs.flatMap((blob) => kzg.computeCells(blob));
    const proofs = cells.map(() => new Uint8Array(48).fill(0)); // filled with all zeros which should fail verification

    const blobsBundle: BlobsBundle = {
      commitments,
      blobs,
      proofs,
    };

    // Create a mock ExecutionPayload
    const mockPayload = {
      blockNumber: 1,
      blockHash: new Uint8Array(32),
      parentHash: new Uint8Array(32),
    } as ExecutionPayload;

    await expect(validateBlobsAndKzgCommitments(ForkName.fulu, mockPayload, blobsBundle)).rejects.toThrow();
  });

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

    const blobsBundle: BlobsBundle = {
      commitments,
      blobs,
      proofs,
    };

    // Create a mock ExecutionPayload
    const mockPayload = {
      blockNumber: 1,
      blockHash: new Uint8Array(32),
      parentHash: new Uint8Array(32),
    } as ExecutionPayload;

    await expect(validateBlobsAndKzgCommitments(ForkName.fulu, mockPayload, blobsBundle, cells)).resolves.not.toThrow();
  });

  it("should throw when cells are not passed post-fulu", async () => {
    const blobs = [generateRandomBlob()];

    // Compute commitments and proofs for each blob
    const commitments: deneb.KZGCommitment[] = [];
    const proofs: deneb.KZGProof[] = [];
    blobs.map((blob) => {
      commitments.push(kzg.blobToKzgCommitment(blob));

      const {proofs: blobProofs} = kzg.computeCellsAndKzgProofs(blob);
      proofs.push(...blobProofs);
    });

    const blobsBundle: BlobsBundle = {
      commitments,
      blobs,
      proofs,
    };

    // Create a mock ExecutionPayload
    const mockPayload = {
      blockNumber: 1,
      blockHash: new Uint8Array(32),
      parentHash: new Uint8Array(32),
    } as ExecutionPayload;

    await expect(validateBlobsAndKzgCommitments(ForkName.fulu, mockPayload, blobsBundle)).rejects.toThrow();
  });
});
