import {bench, describe, setBenchOpts} from "@chainsafe/benchmark";
import {BYTES_PER_FIELD_ELEMENT, FIELD_ELEMENTS_PER_BLOB} from "@lodestar/params";
import {kzg} from "../../../../src/util/kzg.js";

// KZG proof verification
//   single data column sidecar verification
//     ✔ asyncVerifyCellKzgProofBatch - 1 blobs                              229.4809 ops/s    4.357662 ms/op   x1.030         47 runs  0.714 s
//     ✔ asyncVerifyCellKzgProofBatch - 2 blobs                              195.0225 ops/s    5.127614 ms/op   x1.133        114 runs   1.13 s
//     ✔ asyncVerifyCellKzgProofBatch - 4 blobs                              158.4515 ops/s    6.311078 ms/op   x0.942         50 runs  0.817 s
//     ✔ asyncVerifyCellKzgProofBatch - 6 blobs                              146.4209 ops/s    6.829627 ms/op   x0.829         46 runs  0.825 s
//     ✔ asyncVerifyCellKzgProofBatch - 8 blobs                              122.8380 ops/s    8.140803 ms/op   x0.889         39 runs  0.826 s
//     ✔ asyncVerifyCellKzgProofBatch - 12 blobs                             112.1575 ops/s    8.916032 ms/op   x0.919         24 runs  0.725 s
//     ✔ asyncVerifyCellKzgProofBatch - 20 blobs                             85.77360 ops/s    11.65860 ms/op   x0.949         28 runs  0.837 s
//     ✔ asyncVerifyCellKzgProofBatch - 48 blobs                             51.80505 ops/s    19.30314 ms/op   x0.916         18 runs  0.859 s
//     ✔ asyncVerifyCellKzgProofBatch - 72 blobs                             37.34696 ops/s    26.77594 ms/op   x1.002         13 runs  0.863 s
//   parallel column verification
//     ✔ asyncVerifyCellKzgProofBatch - 1 blobs x 128 columns                14.14275 ops/s    70.70761 ms/op        -         11 runs   1.34 s
//     ✔ asyncVerifyCellKzgProofBatch - 2 blobs x 128 columns                12.03836 ops/s    83.06779 ms/op        -         11 runs   1.42 s
//     ✔ asyncVerifyCellKzgProofBatch - 4 blobs x 128 columns                9.231444 ops/s    108.3254 ms/op        -         10 runs   1.64 s
//     ✔ asyncVerifyCellKzgProofBatch - 6 blobs x 128 columns                7.403973 ops/s    135.0626 ms/op        -         10 runs   1.90 s
//     ✔ asyncVerifyCellKzgProofBatch - 8 blobs x 128 columns                6.289518 ops/s    158.9947 ms/op        -         10 runs   2.23 s
//     ✔ asyncVerifyCellKzgProofBatch - 12 blobs x 128 columns               4.757330 ops/s    210.2019 ms/op        -         10 runs   2.73 s
//     ✔ asyncVerifyCellKzgProofBatch - 20 blobs x 128 columns               3.217188 ops/s    310.8305 ms/op        -         10 runs   3.74 s
//     ✔ asyncVerifyCellKzgProofBatch - 48 blobs x 128 columns               2.162751 ops/s    462.3741 ms/op        -         10 runs   5.57 s
//     ✔ asyncVerifyCellKzgProofBatch - 72 blobs x 128 columns               1.526587 ops/s    655.0560 ms/op        -         10 runs   7.19 s

describe("KZG proof verification", () => {
  setBenchOpts({minMs: 30_000});

  describe("single data column sidecar verification", () => {
    const blobCounts = [1, 2, 4, 6, 8, 12, 20, 48, 72];
    const columnIndex = 0; // Test with column 0

    for (const numBlobs of blobCounts) {
      const {commitments, cellIndices, cells, proofs} = generateValidKzgTestData(numBlobs, columnIndex);

      bench({
        id: `asyncVerifyCellKzgProofBatch - ${numBlobs} blobs`,
        fn: async () => {
          const isValid = await kzg.asyncVerifyCellKzgProofBatch(commitments, cellIndices, cells, proofs);
          if (!isValid) {
            throw new Error("Expected proofs to be valid");
          }
        },
      });
    }
  });

  describe("parallel column verification", () => {
    const blobCounts = [1, 2, 4, 6, 8, 12, 20, 48, 72];
    const numColumns = 128;

    for (const numBlobs of blobCounts) {
      const blobsData = [];
      for (let blobIndex = 0; blobIndex < numBlobs; blobIndex++) {
        const blob = generateBlob(blobIndex);
        const commitment = kzg.blobToKzgCommitment(blob);
        const {cells: blobCells, proofs: blobProofs} = kzg.computeCellsAndKzgProofs(blob);
        blobsData.push({commitment, cells: blobCells, proofs: blobProofs});
      }

      const columnTestData: {
        commitments: Uint8Array<ArrayBufferLike>[];
        cellIndices: number[];
        cells: Uint8Array<ArrayBufferLike>[];
        proofs: Uint8Array<ArrayBufferLike>[];
      }[] = [];

      for (let columnIndex = 0; columnIndex < numColumns; columnIndex++) {
        const commitments: Uint8Array[] = [];
        const cellIndices: number[] = [];
        const cells: Uint8Array[] = [];
        const proofs: Uint8Array[] = [];

        for (const blobData of blobsData) {
          commitments.push(blobData.commitment);
          cellIndices.push(columnIndex);
          cells.push(blobData.cells[columnIndex]);
          proofs.push(blobData.proofs[columnIndex]);
        }

        columnTestData.push({commitments, cellIndices, cells, proofs});
      }

      bench({
        id: `asyncVerifyCellKzgProofBatch - ${numBlobs} blobs x ${numColumns} columns`,
        fn: async () => {
          // Run all column verifications in parallel (simulating gossip processing)
          const verificationPromises = columnTestData.map(({commitments, cellIndices, cells, proofs}) =>
            kzg.asyncVerifyCellKzgProofBatch(commitments, cellIndices, cells, proofs)
          );

          const results = await Promise.all(verificationPromises);

          // Verify all columns passed
          if (!results.every((isValid) => isValid)) {
            throw new Error("Expected proofs to be valid");
          }
        },
      });
    }
  });
});

function generateBlob(seed: number): Uint8Array {
  const blob = Buffer.alloc(BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_BLOB);

  for (let i = 0; i < Math.min(10, FIELD_ELEMENTS_PER_BLOB); i++) {
    const offset = i * BYTES_PER_FIELD_ELEMENT;
    blob[offset] = (seed + i) % 128;
  }

  return blob;
}

function generateValidKzgTestData(numBlobs: number, columnIndex: number) {
  const commitments: Uint8Array[] = [];
  const cellIndices: number[] = [];
  const cells: Uint8Array[] = [];
  const proofs: Uint8Array[] = [];

  for (let blobIndex = 0; blobIndex < numBlobs; blobIndex++) {
    const blob = generateBlob(blobIndex);

    const commitment = kzg.blobToKzgCommitment(blob);

    const {cells: blobCells, proofs: blobProofs} = kzg.computeCellsAndKzgProofs(blob);

    commitments.push(commitment);
    cellIndices.push(columnIndex);
    cells.push(blobCells[columnIndex]);
    proofs.push(blobProofs[columnIndex]);
  }

  return {commitments, cellIndices, cells, proofs};
}
