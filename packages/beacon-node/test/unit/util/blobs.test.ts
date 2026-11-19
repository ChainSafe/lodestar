import {describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {reconstructBlobs} from "../../../src/util/blobs.js";
import {getDataColumnSidecarsFromBlock} from "../../../src/util/dataColumns.js";
import {kzg} from "../../../src/util/kzg.js";
import {generateRandomBlob} from "../../utils/kzg.js";

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
  const blobs = [generateRandomBlob(), generateRandomBlob(), generateRandomBlob()];

  // Compute commitments, cells, and proofs for each blob
  const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
  const cellsAndProofs = blobs.map((blob) => kzg.computeCellsAndKzgProofs(blob));

  // Create a test block with the commitments
  const signedBeaconBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
  signedBeaconBlock.message.body.blobKzgCommitments = kzgCommitments;

  const sidecars = getDataColumnSidecarsFromBlock(config, signedBeaconBlock, cellsAndProofs);

  it("should reconstruct all blobs from a complete set of data columns", async () => {
    expect(await reconstructBlobs(sidecars)).toEqual(blobs);
  });

  it("should reconstruct all blobs from at least half of the data columns", async () => {
    // random shuffle + take first 64
    const randomHalf = sidecars
      .slice()
      .sort(() => Math.random() - 0.5)
      .slice(0, NUMBER_OF_COLUMNS / 2);

    expect(await reconstructBlobs(randomHalf)).toEqual(blobs);
  });

  it("should reconstruct only specified blobs from a complete set of data columns", async () => {
    // only first blob
    const firstBlobOnly = await reconstructBlobs(sidecars, [0]);
    expect(firstBlobOnly).toHaveLength(1);
    expect(firstBlobOnly[0]).toEqual(blobs[0]);

    // only last blob
    const lastBlobOnly = await reconstructBlobs(sidecars, [2]);
    expect(lastBlobOnly).toHaveLength(1);
    expect(lastBlobOnly[0]).toEqual(blobs[2]);

    // first and last blobs
    const firstAndLast = await reconstructBlobs(sidecars, [0, 2]);
    expect(firstAndLast).toHaveLength(2);
    expect(firstAndLast[0]).toEqual(blobs[0]);
    expect(firstAndLast[1]).toEqual(blobs[2]);

    // all blobs in different order
    const reversedOrder = await reconstructBlobs(sidecars, [2, 1, 0]);
    expect(reversedOrder).toHaveLength(3);
    expect(reversedOrder[0]).toEqual(blobs[2]);
    expect(reversedOrder[1]).toEqual(blobs[1]);
    expect(reversedOrder[2]).toEqual(blobs[0]);
  });

  it("should reconstruct only specified blobs from at least half of the data columns", async () => {
    // random shuffle + take first 64
    const randomHalf = sidecars
      .slice()
      .sort(() => Math.random() - 0.5)
      .slice(0, NUMBER_OF_COLUMNS / 2);

    // only single blob
    const firstBlobOnly = await reconstructBlobs(randomHalf, [0]);
    expect(firstBlobOnly).toHaveLength(1);
    expect(firstBlobOnly[0]).toEqual(blobs[0]);

    // multiple specific blobs
    const multipleBlobs = await reconstructBlobs(randomHalf, [0, 2]);
    expect(multipleBlobs).toHaveLength(2);
    expect(multipleBlobs[0]).toEqual(blobs[0]);
    expect(multipleBlobs[1]).toEqual(blobs[2]);

    // all blobs in sequential order
    expect(await reconstructBlobs(randomHalf, [0, 1, 2])).toEqual(blobs);
  });

  it("should throw for invalid blob indices", async () => {
    // negative index
    await expect(reconstructBlobs(sidecars, [-1])).rejects.toThrow("Invalid blob index -1");

    // out of range index
    await expect(reconstructBlobs(sidecars, [3])).rejects.toThrow("Invalid blob index 3");

    // valid and invalid
    await expect(reconstructBlobs(sidecars, [0, 5])).rejects.toThrow("Invalid blob index 5");
  });

  it("should throw if less than half of the data columns are provided", async () => {
    const lessThanHalf = sidecars.slice(0, NUMBER_OF_COLUMNS / 2 - 10);

    await expect(reconstructBlobs(lessThanHalf)).rejects.toThrow();
  });
});
