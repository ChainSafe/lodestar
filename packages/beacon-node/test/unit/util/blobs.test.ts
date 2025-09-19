import {createChainForkConfig} from "@lodestar/config";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
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
  const blobs = [generateRandomBlob(), generateRandomBlob()];

  // Compute commitments, cells, and proofs for each blob
  const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
  const cellsAndProofs = blobs.map((blob) => kzg.computeCellsAndKzgProofs(blob));

  // Create a test block with the commitments
  const signedBeaconBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
  signedBeaconBlock.message.body.blobKzgCommitments = kzgCommitments;

  const sidecars = getDataColumnSidecarsFromBlock(config, signedBeaconBlock, cellsAndProofs);

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
