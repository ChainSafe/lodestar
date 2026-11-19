import {DasContextJs} from "@crate-crypto/node-eth-kzg";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {InputType} from "@lodestar/spec-test-util";
import {TestRunnerFn} from "../utils/types.js";

const kzg = DasContextJs.create({usePrecomp: true});

const testFnByType: Record<string, (input: any, output?: any) => any> = {
  blob_to_kzg_commitment: blobToKzgCommitment,
  compute_blob_kzg_proof: computeBlobKzgProof,
  compute_kzg_proof: computeKzgProof,
  verify_blob_kzg_proof: verifyBlobKzgProof,
  verify_blob_kzg_proof_batch: verifyBlobKzgProofBatch,
  verify_kzg_proof: verifyKzgProof,
  compute_cells: computeCells,
  compute_cells_and_kzg_proofs: computeCellsAndKzgProofs,
  recover_cells_and_kzg_proofs: recoverCellsAndKzgProofs,
  verify_cell_kzg_proof_batch: verifyCellKzgProofBatch,
};

export const kzgTestRunner: TestRunnerFn<KzgTestCase, unknown> = (_fork, testName) => {
  return {
    testFunction: ({data}) => {
      const testFn = testFnByType[testName];
      if (testFn === undefined) {
        throw Error(`Unknown kzg test ${testName}`);
      }

      return testFn(data.input, data.output);
    },
    options: {
      inputTypes: {data: InputType.YAML},
      getExpected: (testCase) => testCase.data.output,
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/general/index.test.ts
    },
  };
};

type KzgTestCase = {
  meta?: any;
  data: {
    input: unknown;
    output: unknown;
  };
};

type BlobToKzgCommitmentInput = {
  blob: string;
};
function blobToKzgCommitment(input: BlobToKzgCommitmentInput): string | null {
  const blob = fromHexString(input.blob);
  try {
    return toHexString(kzg.blobToKzgCommitment(blob));
  } catch {
    return null;
  }
}

type ComputeKzgProofInput = {
  blob: string;
  z: string;
};
function computeKzgProof(input: ComputeKzgProofInput): string[] | null {
  const blob = fromHexString(input.blob);
  const z = fromHexString(input.z);
  try {
    const [proof, polynomialResult] = kzg.computeKzgProof(blob, z);
    return [toHexString(proof), toHexString(polynomialResult)];
  } catch {
    return null;
  }
}

type ComputeBlobKzgProofInput = {
  blob: string;
  commitment: string;
};
function computeBlobKzgProof(input: ComputeBlobKzgProofInput): string | null {
  const blob = fromHexString(input.blob);
  const commitment = fromHexString(input.commitment);
  try {
    return toHexString(kzg.computeBlobKzgProof(blob, commitment));
  } catch {
    return null;
  }
}

type VerifyKzgProofInput = {
  commitment: string;
  y: string;
  z: string;
  proof: string;
};
function verifyKzgProof(input: VerifyKzgProofInput): boolean | null {
  const commitment = fromHexString(input.commitment);
  const z = fromHexString(input.z);
  const y = fromHexString(input.y);
  const proof = fromHexString(input.proof);

  try {
    return kzg.verifyKzgProof(commitment, z, y, proof);
  } catch {
    return null;
  }
}

type VerifyBlobKzgProofInput = {
  blob: string;
  commitment: string;
  proof: string;
};
function verifyBlobKzgProof(input: VerifyBlobKzgProofInput): boolean | null {
  const blob = fromHexString(input.blob);
  const commitment = fromHexString(input.commitment);
  const proof = fromHexString(input.proof);

  try {
    return kzg.verifyBlobKzgProof(blob, commitment, proof);
  } catch {
    return null;
  }
}

type VerifyBlobKzgProofBatchInput = {
  blobs: string[];
  commitments: string[];
  proofs: string[];
};
function verifyBlobKzgProofBatch(input: VerifyBlobKzgProofBatchInput): boolean | null {
  const blobs = input.blobs.map(fromHexString);
  const commitments = input.commitments.map(fromHexString);
  const proofs = input.proofs.map(fromHexString);

  try {
    return kzg.verifyBlobKzgProofBatch(blobs, commitments, proofs);
  } catch {
    return null;
  }
}

type ComputeCellsInput = {
  blob: string;
};
function computeCells(input: ComputeCellsInput): string[] | null {
  const blob = fromHexString(input.blob);
  try {
    const cells = kzg.computeCells(blob);
    return cells.map(toHexString);
  } catch {
    return null;
  }
}

type ComputeCellsAndKzgProofsInput = {
  blob: string;
};
function computeCellsAndKzgProofs(input: ComputeCellsAndKzgProofsInput): [string[], string[]] | null {
  const blob = fromHexString(input.blob);
  try {
    const {cells, proofs} = kzg.computeCellsAndKzgProofs(blob);
    return [cells.map(toHexString), proofs.map(toHexString)];
  } catch {
    return null;
  }
}

type RecoverCellsAndKzgProofsInput = {
  cell_indices: number[];
  cells: string[];
};
function recoverCellsAndKzgProofs(input: RecoverCellsAndKzgProofsInput): [string[], string[]] | null {
  const cellIndices = input.cell_indices.map(BigInt);
  const cells = input.cells.map(fromHexString);
  try {
    const {cells: recoveredCells, proofs: recoveredProofs} = kzg.recoverCellsAndKzgProofs(cellIndices, cells);
    return [recoveredCells.map(toHexString), recoveredProofs.map(toHexString)];
  } catch {
    return null;
  }
}

type VerifyCellKzgProofBatchInput = {
  commitments: string[];
  cell_indices: number[];
  cells: string[];
  proofs: string[];
};
function verifyCellKzgProofBatch(input: VerifyCellKzgProofBatchInput): boolean | null {
  const commitments = input.commitments.map(fromHexString);
  const cellIndices = input.cell_indices.map(BigInt);
  const cells = input.cells.map(fromHexString);
  const proofs = input.proofs.map(fromHexString);
  try {
    return kzg.verifyCellKzgProofBatch(commitments, cellIndices, cells, proofs);
  } catch {
    return null;
  }
}
