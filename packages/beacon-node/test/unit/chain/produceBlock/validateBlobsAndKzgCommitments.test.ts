import {describe, expect, it, beforeAll} from "vitest";
import {BlobsBundle} from "../../../../src/execution/index.js";
import {validateBlobsAndKzgCommitments} from "../../../../src/chain/produceBlock/validateBlobsAndKzgCommitments.js";
import {ckzg, initCKZG, loadEthereumTrustedSetup} from "../../../../src/util/kzg.js";
import {CELLS_PER_EXT_BLOB, ForkName} from "@lodestar/params";
import {generateRandomBlob} from "../../../utils/kzg.js";
import {ExecutionPayload} from "@lodestar/types";

describe("validateBlobsAndKzgCommitments", () => {
  beforeAll(async () => {
    await initCKZG();
    loadEthereumTrustedSetup();
  });

  it("should validate a valid V1 (deneb) blobs bundle", () => {
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const commitments = blobs.map((blob) => ckzg.blobToKzgCommitment(blob));
    const proofs = blobs.map(() => new Uint8Array(48).fill(1));

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

  it("should validate a valid V2 (electra) blobs bundle", () => {
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const commitments = blobs.map((blob) => ckzg.blobToKzgCommitment(blob));
    const proofs = blobs.flatMap((blob) => ckzg.computeCellsAndKzgProofs(blob)[1]);

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
});
