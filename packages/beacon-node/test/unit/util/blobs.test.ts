import {createChainForkConfig} from "@lodestar/config";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {deneb, fulu, ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import {computeDataColumnSidecars, reconstructBlobs} from "../../../src/util/blobs.js";
import {kzg} from "../../../src/util/kzg.js";
import {generateRandomBlob} from "../../utils/kzg.js";

describe("computeDataColumnSidecars", () => {
  const config = createChainForkConfig({
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
  });

  it("should compute DataColumnSidecars when cells are not provided", () => {
    // Generate test data
    const blobs = [generateRandomBlob(), generateRandomBlob()];

    // Compute commitments, cells, and proofs for each blob
    const kzgCommitments: deneb.KZGCommitment[] = [];
    const cells: fulu.Cell[][] = [];
    const kzgProofs: deneb.KZGProof[] = [];
    blobs.map((blob) => {
      kzgCommitments.push(kzg.blobToKzgCommitment(blob));

      const {cells: blobCells, proofs} = kzg.computeCellsAndKzgProofs(blob);
      cells.push(blobCells);
      kzgProofs.push(...proofs);
    });

    // Create a test block with the commitments
    const signedBeaconBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
    signedBeaconBlock.message.body.blobKzgCommitments = kzgCommitments;

    // Compute sidecars without providing cells
    const sidecars = computeDataColumnSidecars(config, signedBeaconBlock, {
      blobs,
      kzgProofs,
    });

    // Verify the results
    expect(sidecars.length).toBe(NUMBER_OF_COLUMNS);
    expect(sidecars[0].column.length).toBe(blobs.length);
    for (let i = 0; i < blobs.length; i++) {
      for (let j = 0; j < NUMBER_OF_COLUMNS; j++) {
        expect(sidecars[j].column[i]).toEqual(cells[i][j]);
      }
    }
  });

  it("should use provided cells when available", () => {
    // Generate test data
    const blobs = [generateRandomBlob(), generateRandomBlob()];

    // Compute commitments, cells, and proofs for each blob
    const kzgCommitments: deneb.KZGCommitment[] = [];
    const cells: fulu.Cell[][] = [];
    const kzgProofs: deneb.KZGProof[] = [];
    blobs.map((blob) => {
      kzgCommitments.push(kzg.blobToKzgCommitment(blob));

      const {cells: blobCells, proofs} = kzg.computeCellsAndKzgProofs(blob);
      cells.push(blobCells);
      kzgProofs.push(...proofs);
    });

    // Create a test block with the commitments
    const signedBeaconBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
    signedBeaconBlock.message.body.blobKzgCommitments = kzgCommitments;

    // Compute sidecars with provided cells
    const sidecars = computeDataColumnSidecars(config, signedBeaconBlock, {
      blobs,
      kzgProofs,
      cells,
    });

    // Verify the results
    expect(sidecars.length).toBe(NUMBER_OF_COLUMNS);
    expect(sidecars[0].column.length).toBe(blobs.length);
    for (let i = 0; i < blobs.length; i++) {
      for (let j = 0; j < NUMBER_OF_COLUMNS; j++) {
        expect(sidecars[j].column[i]).toEqual(cells[i][j]);
      }
    }
  });

  it("should throw error when block is missing blobKzgCommitments", () => {
    const signedBeaconBlock = ssz.phase0.SignedBeaconBlock.defaultValue() as any;
    const blobs = [generateRandomBlob()];
    const kzgProofs = blobs.flatMap((blob) => kzg.computeCellsAndKzgProofs(blob).proofs);

    expect(() =>
      computeDataColumnSidecars(config, signedBeaconBlock, {
        blobs,
        kzgProofs,
      })
    ).toThrow("Invalid block with missing blobKzgCommitments for computeDataColumnSidecars");
  });
});

describe("reconstructBlobs", () => {
  const config = createChainForkConfig({
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
  });

  // Generate test data
  const blobs = [generateRandomBlob(), generateRandomBlob()];

  // Compute commitments, cells, and proofs for each blob
  const kzgCommitments: deneb.KZGCommitment[] = [];
  const cells: fulu.Cell[][] = [];
  const kzgProofs: deneb.KZGProof[] = [];
  for (const blob of blobs) {
    kzgCommitments.push(kzg.blobToKzgCommitment(blob));

    const {cells: blobCells, proofs} = kzg.computeCellsAndKzgProofs(blob);
    cells.push(blobCells);
    kzgProofs.push(...proofs);
  }

  // Create a test block with the commitments
  const signedBeaconBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
  signedBeaconBlock.message.body.blobKzgCommitments = kzgCommitments;

  // Compute sidecars without providing cells
  const sidecars = computeDataColumnSidecars(config, signedBeaconBlock, {
    blobs,
    kzgProofs,
  });

  it("should reconstruct blobs from a complete set of data columns", async () => {
    expect(await reconstructBlobs(sidecars)).toEqual(blobs);
  });

  it("should reconstruct blobs from at least half of the data columns", async () => {
    // random shuffle + take first 64
    const randomHalf = sidecars
      .slice()
      .sort(() => Math.random() - 0.5)
      .slice(0, NUMBER_OF_COLUMNS / 2);

    expect(await reconstructBlobs(randomHalf)).toEqual(blobs);
  });

  it("should throw if less than half of the data columns are provided", async () => {
    const lessThanHalf = sidecars.slice(0, NUMBER_OF_COLUMNS / 2 - 10);

    await expect(reconstructBlobs(lessThanHalf)).rejects.toThrow();
  });
});
