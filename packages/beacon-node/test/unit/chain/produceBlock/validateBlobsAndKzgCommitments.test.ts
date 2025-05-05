import {CELLS_PER_EXT_BLOB, ForkName} from "@lodestar/params";
import {ExecutionPayload, deneb, fulu} from "@lodestar/types";
import {beforeAll, describe, expect, it} from "vitest";
import {validateBlobsAndKzgCommitments} from "../../../../src/chain/produceBlock/validateBlobsAndKzgCommitments.js";
import {BlobsBundle} from "../../../../src/execution/index.js";
import {ckzg, initCKZG, loadEthereumTrustedSetup} from "../../../../src/util/kzg.js";
import {generateRandomBlob} from "../../../utils/kzg.js";

describe("validateBlobsAndKzgCommitments", () => {
  beforeAll(async () => {
    await initCKZG();
    loadEthereumTrustedSetup();
  });

  it("should validate a valid V1 blobs bundle", () => {
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const commitments = [];
    const proofs = [];

    for (const blob of blobs) {
      const commitment = ckzg.blobToKzgCommitment(blob);
      const proof = ckzg.computeBlobKzgProof(blob, commitment);

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

    expect(() => validateBlobsAndKzgCommitments(ForkName.deneb, mockPayload, blobsBundle)).not.toThrow();
  });

  it("should throw if V1 blobs bundle proof verification fails", () => {
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const commitments = blobs.map((blob) => ckzg.blobToKzgCommitment(blob));
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

    expect(() => validateBlobsAndKzgCommitments(ForkName.deneb, mockPayload, blobsBundle)).toThrow(
      "Error in verifyBlobKzgProofBatch"
    );
  });

  it("should throw if commitments and blobs lengths don't match", () => {
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

    expect(() => validateBlobsAndKzgCommitments(ForkName.deneb, mockPayload, blobsBundle)).toThrow(
      "Blobs bundle blobs len 2 != commitments len 1"
    );
  });

  it("should throw if V1 proofs length is incorrect", () => {
    const blobs = [generateRandomBlob()];
    const commitments = blobs.map((blob) => ckzg.blobToKzgCommitment(blob));
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

    expect(() => validateBlobsAndKzgCommitments(ForkName.deneb, mockPayload, blobsBundle)).toThrow(
      "Invalid proofs length for BlobsBundleV1 format: expected 1, got 0"
    );
  });

  it("should throw if V2 proofs length is incorrect", () => {
    const blobs = [generateRandomBlob()];
    const commitments = blobs.map((blob) => ckzg.blobToKzgCommitment(blob));
    const blobsBundle: BlobsBundle = {
      commitments,
      blobs,
      proofs: [new Uint8Array(48).fill(1)], // Only one proof when we need CELLS_PER_EXT_BLOB
    };

    // Create a mock ExecutionPayload
    const mockPayload = {
      blockNumber: 1,
      blockHash: new Uint8Array(32),
      parentHash: new Uint8Array(32),
    } as ExecutionPayload;

    expect(() => validateBlobsAndKzgCommitments(ForkName.fulu, mockPayload, blobsBundle)).toThrow(
      `Invalid proofs length for BlobsBundleV2 format: expected ${CELLS_PER_EXT_BLOB}, got 1`
    );
  });

  it("should throw if V2 cell proofs verification fails", () => {
    const blobs = [generateRandomBlob()];
    const commitments = blobs.map((blob) => ckzg.blobToKzgCommitment(blob));
    const cells = blobs.flatMap((blob) => ckzg.computeCells(blob));
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

    expect(() => validateBlobsAndKzgCommitments(ForkName.fulu, mockPayload, blobsBundle)).toThrow(
      "Error in verifyCellKzgProofBatch"
    );
  });

  it("should validate BlobsBundleV2 when cells are passed", () => {
    const blobs = [generateRandomBlob()];

    // Compute commitments, cells, and proofs for each blob
    const commitments: deneb.KZGCommitment[] = [];
    const cells: fulu.Cell[][] = [];
    const proofs: deneb.KZGProof[] = [];
    blobs.map((blob) => {
      commitments.push(ckzg.blobToKzgCommitment(blob));

      const [blobCells, blobProofs] = ckzg.computeCellsAndKzgProofs(blob);
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

    expect(() => validateBlobsAndKzgCommitments(ForkName.fulu, mockPayload, blobsBundle, cells)).not.toThrow();
  });

  it("should validate V2 blobs bundle when cells are not passed", () => {
    const blobs = [generateRandomBlob()];

    // Compute commitments and proofs for each blob
    const commitments: deneb.KZGCommitment[] = [];
    const proofs: deneb.KZGProof[] = [];
    blobs.map((blob) => {
      commitments.push(ckzg.blobToKzgCommitment(blob));

      const [_, blobProofs] = ckzg.computeCellsAndKzgProofs(blob);
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

    expect(() => validateBlobsAndKzgCommitments(ForkName.fulu, mockPayload, blobsBundle)).not.toThrow();
  });
});
