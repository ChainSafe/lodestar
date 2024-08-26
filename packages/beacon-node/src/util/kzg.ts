// "c-kzg" has hardcoded the mainnet value, do not use params
export const FIELD_ELEMENTS_PER_BLOB_MAINNET = 4096;

function ckzgNotLoaded(): never {
  throw Error("c-kzg library not loaded");
}

export let ckzg: {
  freeTrustedSetup(): void;
  loadTrustedSetup(precompute: number, filePath?: string): void;
  blobToKzgCommitment(blob: Uint8Array): Uint8Array;
  computeBlobKzgProof(blob: Uint8Array, commitment: Uint8Array): Uint8Array;
  verifyBlobKzgProof(blob: Uint8Array, commitment: Uint8Array, proof: Uint8Array): boolean;
  verifyBlobKzgProofBatch(blobs: Uint8Array[], expectedKzgCommitments: Uint8Array[], kzgProofs: Uint8Array[]): boolean;
  computeCellsAndKzgProofs(blob: Uint8Array): [Uint8Array[], Uint8Array[]];
  recoverCellsAndKzgProofs(cellIndices: number[], cells: Uint8Array[]): [Uint8Array[], Uint8Array[]];
  verifyCellKzgProofBatch(
    commitmentsBytes: Uint8Array[],
    cellIndices: number[],
    cells: Uint8Array[],
    proofsBytes: Uint8Array[]
  ): boolean;
} = {
  freeTrustedSetup: ckzgNotLoaded,
  loadTrustedSetup: ckzgNotLoaded,
  blobToKzgCommitment: ckzgNotLoaded,
  computeBlobKzgProof: ckzgNotLoaded,
  verifyBlobKzgProof: ckzgNotLoaded,
  verifyBlobKzgProofBatch: ckzgNotLoaded,
  computeCellsAndKzgProofs: ckzgNotLoaded,
  recoverCellsAndKzgProofs: ckzgNotLoaded,
  verifyCellKzgProofBatch: ckzgNotLoaded,
};

export async function initCKZG(): Promise<void> {
  /* eslint-disable @typescript-eslint/ban-ts-comment */
  // @ts-ignore
  ckzg = (await import("c-kzg")).default as typeof ckzg;
  /* eslint-enable @typescript-eslint/ban-ts-comment */
}

/**
 * Load our KZG trusted setup into C-KZG for later use.
 * We persist the trusted setup as serialized bytes to save space over TXT or JSON formats.
 * However the current c-kzg API **requires** to read from a file with a specific .txt format
 */
export function loadEthereumTrustedSetup(
  precompute = 0, // default to 0 for testing
  filePath?: string
): void {
  try {
    try {
      // in unit tests, calling loadTrustedSetup() twice has error so we have to free and retry
      ckzg.loadTrustedSetup(precompute, filePath);
    } catch (e) {
      if ((e as Error).message !== "Error trusted setup is already loaded") {
        throw e;
      }
    }
  } catch (e) {
    (e as Error).message = filePath
      ? `Error loading trusted setup ${filePath}: ${(e as Error).message}`
      : `Error loading default trusted setup: ${(e as Error).message}`;
    throw e;
  }
}
