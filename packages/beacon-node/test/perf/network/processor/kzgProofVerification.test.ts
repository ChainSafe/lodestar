import {bench, describe, setBenchOpts} from "@chainsafe/benchmark";
import {BYTES_PER_FIELD_ELEMENT, FIELD_ELEMENTS_PER_BLOB} from "@lodestar/params";
import {kzg} from "../../../../src/util/kzg.js";

// KZG proof verification
//   single data column sidecar verification
//     ✔ asyncVerifyCellKzgProofBatch - 1 blobs                              288.7284 ops/s    3.463462 ms/op   x0.795         88 runs  0.819 s
//     ✔ asyncVerifyCellKzgProofBatch - 2 blobs                              207.3141 ops/s    4.823598 ms/op   x0.941         44 runs  0.715 s
//     ✔ asyncVerifyCellKzgProofBatch - 4 blobs                              177.0196 ops/s    5.649093 ms/op   x0.895         55 runs  0.827 s
//     ✔ asyncVerifyCellKzgProofBatch - 6 blobs                              135.9839 ops/s    7.353814 ms/op   x1.077         57 runs  0.925 s
//     ✔ asyncVerifyCellKzgProofBatch - 8 blobs                              133.8985 ops/s    7.468342 ms/op   x0.917         57 runs  0.930 s
//     ✔ asyncVerifyCellKzgProofBatch - 12 blobs                             115.6600 ops/s    8.646032 ms/op   x0.970         24 runs  0.725 s
//     ✔ asyncVerifyCellKzgProofBatch - 20 blobs                             84.71706 ops/s    11.80400 ms/op   x1.012         35 runs  0.938 s
//     ✔ asyncVerifyCellKzgProofBatch - 48 blobs                             48.31236 ops/s    20.69864 ms/op   x1.072         17 runs  0.869 s
//     ✔ asyncVerifyCellKzgProofBatch - 72 blobs                             37.12524 ops/s    26.93586 ms/op   x1.006         13 runs  0.881 s
//   parallel column verification
//     ✔ asyncVerifyCellKzgProofBatch - 1 blobs x 128 columns                12.38361 ops/s    80.75190 ms/op   x1.142         11 runs   1.43 s
//     ✔ asyncVerifyCellKzgProofBatch - 2 blobs x 128 columns                10.52015 ops/s    95.05567 ms/op   x1.144         12 runs   1.67 s
//     ✔ asyncVerifyCellKzgProofBatch - 4 blobs x 128 columns                8.611444 ops/s    116.1245 ms/op   x1.072         10 runs   1.76 s
//     ✔ asyncVerifyCellKzgProofBatch - 6 blobs x 128 columns                7.050198 ops/s    141.8400 ms/op   x1.050         10 runs   2.00 s
//     ✔ asyncVerifyCellKzgProofBatch - 8 blobs x 128 columns                5.385339 ops/s    185.6893 ms/op   x1.168         10 runs   2.41 s
//     ✔ asyncVerifyCellKzgProofBatch - 12 blobs x 128 columns               4.064273 ops/s    246.0464 ms/op   x1.171         10 runs   3.20 s
//     ✔ asyncVerifyCellKzgProofBatch - 20 blobs x 128 columns               2.913910 ops/s    343.1815 ms/op   x1.104         10 runs   4.12 s
//     ✔ asyncVerifyCellKzgProofBatch - 48 blobs x 128 columns               2.015242 ops/s    496.2183 ms/op   x1.073         10 runs   5.49 s
//     ✔ asyncVerifyCellKzgProofBatch - 72 blobs x 128 columns               1.447976 ops/s    690.6191 ms/op   x1.054         10 runs   7.71 s
//   single batch verification
//     ✔ asyncVerifyCellKzgProofBatch - 1 blobs x 128 columns batch          35.06851 ops/s    28.51562 ms/op        -         13 runs  0.879 s
//     ✔ asyncVerifyCellKzgProofBatch - 2 blobs x 128 columns batch          19.44367 ops/s    51.43062 ms/op        -         10 runs   1.04 s
//     ✔ asyncVerifyCellKzgProofBatch - 4 blobs x 128 columns batch          10.05118 ops/s    99.49080 ms/op        -         11 runs   1.61 s
//     ✔ asyncVerifyCellKzgProofBatch - 6 blobs x 128 columns batch          6.800827 ops/s    147.0409 ms/op        -         10 runs   2.07 s
//     ✔ asyncVerifyCellKzgProofBatch - 8 blobs x 128 columns batch          5.109904 ops/s    195.6984 ms/op        -         10 runs   2.56 s
//     ✔ asyncVerifyCellKzgProofBatch - 12 blobs x 128 columns batch         3.369759 ops/s    296.7571 ms/op        -         10 runs   3.56 s
//     ✔ asyncVerifyCellKzgProofBatch - 20 blobs x 128 columns batch         2.063158 ops/s    484.6938 ms/op        -         10 runs   5.81 s
//     ✔ asyncVerifyCellKzgProofBatch - 48 blobs x 128 columns batch        0.8347890 ops/s    1.197908  s/op        -         10 runs   13.2 s
//     ✔ asyncVerifyCellKzgProofBatch - 72 blobs x 128 columns batch        0.5678239 ops/s    1.761109  s/op        -         10 runs   19.6 s

describe("KZG proof verification", () => {
  setBenchOpts({minMs: 30_000});

  describe("single data column sidecar verification", () => {
    const blobCounts = [1, 2, 4, 6, 8, 12, 20, 48, 72];
    const columnIndex = 0;

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
          const verificationPromises = columnTestData.map(({commitments, cellIndices, cells, proofs}) =>
            kzg.asyncVerifyCellKzgProofBatch(commitments, cellIndices, cells, proofs)
          );

          const results = await Promise.all(verificationPromises);

          if (!results.every((isValid) => isValid)) {
            throw new Error("Expected proofs to be valid");
          }
        },
      });
    }
  });

  describe("single batch verification", () => {
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

      const allCommitments: Uint8Array[] = [];
      const allCellIndices: number[] = [];
      const allCells: Uint8Array[] = [];
      const allProofs: Uint8Array[] = [];

      for (const blobData of blobsData) {
        for (let columnIndex = 0; columnIndex < numColumns; columnIndex++) {
          allCommitments.push(blobData.commitment);
          allCellIndices.push(columnIndex);
          allCells.push(blobData.cells[columnIndex]);
          allProofs.push(blobData.proofs[columnIndex]);
        }
      }

      bench({
        id: `asyncVerifyCellKzgProofBatch - ${numBlobs} blobs x ${numColumns} columns batch`,
        fn: async () => {
          const isValid = await kzg.asyncVerifyCellKzgProofBatch(allCommitments, allCellIndices, allCells, allProofs);
          if (!isValid) {
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
