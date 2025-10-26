import {bench, describe} from "@chainsafe/benchmark";
import {createChainForkConfig} from "@lodestar/config";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {reconstructBlobs} from "../../../src/util/blobs.ts";
import {getDataColumnSidecarsFromBlock} from "../../../src/util/dataColumns.ts";
import {kzg} from "../../../src/util/kzg.ts";
import {generateRandomBlob} from "../../utils/kzg.ts";

describe("reconstructBlobs", () => {
  const config = createChainForkConfig({
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
  });

  const testCases = [
    {blobCount: 6, name: "6 blobs"},
    {blobCount: 10, name: "10 blobs"},
    {blobCount: 20, name: "20 blobs"},
    // Disabled as those take too long to run
    // {blobCount: 48, name: "48 blobs"},
    // {blobCount: 72, name: "72 blobs"},
  ];

  for (const {blobCount, name} of testCases) {
    describe(`Reconstruct blobs - ${name}`, () => {
      const blobs = Array.from({length: blobCount}, (_) => generateRandomBlob());
      const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
      const cellsAndProofs = blobs.map((blob) => kzg.computeCellsAndKzgProofs(blob));

      const signedBeaconBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
      signedBeaconBlock.message.body.blobKzgCommitments = kzgCommitments;

      const allSidecars = getDataColumnSidecarsFromBlock(config, signedBeaconBlock, cellsAndProofs);
      const halfSidecars = allSidecars.sort(() => Math.random() - 0.5).slice(0, NUMBER_OF_COLUMNS / 2);

      const scenarios = [
        {sidecars: allSidecars, name: "Full columns"},
        {sidecars: halfSidecars, name: "Half columns"},
      ];

      for (const {sidecars, name} of scenarios) {
        bench({
          id: `${name} - reconstruct all ${blobCount} blobs`,
          fn: async () => {
            await reconstructBlobs(sidecars);
          },
        });

        bench({
          id: `${name} - reconstruct half of the blobs out of ${blobCount}`,
          fn: async () => {
            const indices = Array.from({length: blobCount / 2}, (_, i) => i);
            await reconstructBlobs(sidecars, indices);
          },
        });

        bench({
          id: `${name} - reconstruct single blob out of ${blobCount}`,
          fn: async () => {
            await reconstructBlobs(sidecars, [0]);
          },
        });
      }
    });
  }
});
