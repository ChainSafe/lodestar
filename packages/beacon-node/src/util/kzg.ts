import path from "node:path";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {fromHex, toHex} from "@lodestar/utils";

/* eslint-disable @typescript-eslint/naming-convention */

// "c-kzg" has hardcoded the mainnet value, do not use params
export const FIELD_ELEMENTS_PER_BLOB_MAINNET = 4096;

function ckzgNotLoaded(): never {
  throw Error("c-kzg library not loaded");
}

export let ckzg: {
  freeTrustedSetup(): void;
  loadTrustedSetup(precompute: number, filePath: string): void;
  blobToKzgCommitment(blob: Uint8Array): Uint8Array;
  computeBlobKzgProof(blob: Uint8Array, commitment: Uint8Array): Uint8Array;
  verifyBlobKzgProof(blob: Uint8Array, commitment: Uint8Array, proof: Uint8Array): boolean;
  verifyBlobKzgProofBatch(blobs: Uint8Array[], expectedKzgCommitments: Uint8Array[], kzgProofs: Uint8Array[]): boolean;
  // Deprecated: Use `computeCellsAndKzgProofs`
  computeCells(blob: Uint8Array): Uint8Array[];
  computeCellsAndKzgProofs(blob: Uint8Array): [Uint8Array[], Uint8Array[]];
  // Deprecated: Now being done internally in `recoverCellsAndKzgProofs`
  cellsToBlob(cells: Uint8Array[]): Uint8Array;
  // Deprecated: Use recoverCellsAndKzgProofs
  recoverAllCells(cellIds: number[], cells: Uint8Array[]): Uint8Array[];
  recoverCellsAndKzgProofs(cellIndices: number[], cells: Uint8Array[]): [Uint8Array[], Uint8Array[]];
  // Deprecated: not used and removed from specs
  verifyCellKzgProof(commitmentBytes: Uint8Array, cellId: number, cell: Uint8Array, proofBytes: Uint8Array): boolean;
  // This API will no longer take rowIndices in the future, in particular the rowIndices is no longer used.
  verifyCellKzgProofBatch(
    commitmentsBytes: Uint8Array[],
    rowIndices: number[],
    columnIndices: number[],
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
  computeCells: ckzgNotLoaded,
  computeCellsAndKzgProofs: ckzgNotLoaded,
  cellsToBlob: ckzgNotLoaded,
  recoverAllCells: ckzgNotLoaded,
  verifyCellKzgProof: ckzgNotLoaded,
  verifyCellKzgProofBatch: ckzgNotLoaded,
  recoverCellsAndKzgProofs(cellIndices: number[], cells: Uint8Array[]): [Uint8Array[], Uint8Array[]] {
    // First recover all of the cells
    const recoveredCells = this.recoverAllCells(cellIndices, cells);
    // Convert the cells to a Blob
    const blob = this.cellsToBlob(recoveredCells);
    // Compute Cells and Proofs
    return this.computeCellsAndKzgProofs(blob);
  },
};

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TRUSTED_SETUP_BIN_FILEPATH = path.join(__dirname, "../../trusted_setup.bin");
const TRUSTED_SETUP_JSON_FILEPATH = path.join(__dirname, "../../trusted_setup.json");
const TRUSTED_SETUP_TXT_FILEPATH = path.join(__dirname, "../../trusted_setup.txt");

const POINT_COUNT_BYTES = 4;
const G1POINT_BYTES = 48;
const G2POINT_BYTES = 96;
const G1POINT_COUNT = FIELD_ELEMENTS_PER_BLOB_MAINNET;
const G2POINT_COUNT = 65;
const TOTAL_SIZE = 2 * POINT_COUNT_BYTES + G1POINT_BYTES * G1POINT_COUNT + G2POINT_BYTES * G2POINT_COUNT;

export async function initCKZG(): Promise<void> {
  /* eslint-disable @typescript-eslint/ban-ts-comment */
  // @ts-ignore
  ckzg = (await import("c-kzg")).default as typeof ckzg;
  /* eslint-enable @typescript-eslint/ban-ts-comment */
}

export enum TrustedFileMode {
  Bin = "bin",
  Txt = "txt",
}

/**
 * Load our KZG trusted setup into C-KZG for later use.
 * We persist the trusted setup as serialized bytes to save space over TXT or JSON formats.
 * However the current c-kzg API **requires** to read from a file with a specific .txt format
 */
export function loadEthereumTrustedSetup(
  mode: TrustedFileMode = TrustedFileMode.Txt,
  precompute = 0, // default to 0 for testing
  filePath?: string
): void {
  try {
    let setupFilePath;
    if (mode === TrustedFileMode.Bin) {
      const binPath = filePath ?? TRUSTED_SETUP_BIN_FILEPATH;
      const bytes = fs.readFileSync(binPath);
      const json = trustedSetupBinToJson(bytes);
      const txt = trustedSetupJsonToTxt(json);
      fs.writeFileSync(TRUSTED_SETUP_TXT_FILEPATH, txt);
      setupFilePath = TRUSTED_SETUP_TXT_FILEPATH;
    } else {
      setupFilePath = filePath ?? TRUSTED_SETUP_TXT_FILEPATH;
    }

    try {
      // in unit tests, calling loadTrustedSetup() twice has error so we have to free and retry
      ckzg.loadTrustedSetup(precompute, setupFilePath);
    } catch (e) {
      if ((e as Error).message !== "Error trusted setup is already loaded") {
        throw e;
      }
    }
  } catch (e) {
    (e as Error).message = `Error loading trusted setup ${TRUSTED_SETUP_JSON_FILEPATH}: ${(e as Error).message}`;
    throw e;
  }
}

/* eslint-disable @typescript-eslint/naming-convention */
export interface TrustedSetupJSON {
  setup_G1: string[];
  setup_G2: string[];
}

type TrustedSetupBin = Uint8Array;
type TrustedSetupTXT = string;

/**
 * Custom format defined in https://github.com/ethereum/c-kzg-4844/issues/3
 */
export function trustedSetupJsonToBin(data: TrustedSetupJSON): TrustedSetupBin {
  const out = new Uint8Array(TOTAL_SIZE);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);

  dv.setUint32(0, G1POINT_COUNT);
  dv.setUint32(POINT_COUNT_BYTES, G2POINT_BYTES);

  for (let i = 0; i < G1POINT_COUNT; i++) {
    const point = fromHex(data.setup_G1[i]);
    if (point.length !== G1POINT_BYTES) throw Error(`g1 point size ${point.length} != ${G1POINT_BYTES}`);
    out.set(point, 2 * POINT_COUNT_BYTES + i * G1POINT_BYTES);
  }

  for (let i = 0; i < G2POINT_COUNT; i++) {
    const point = fromHex(data.setup_G2[i]);
    if (point.length !== G2POINT_BYTES) throw Error(`g2 point size ${point.length} != ${G2POINT_BYTES}`);
    out.set(point, 2 * POINT_COUNT_BYTES + G1POINT_COUNT * G1POINT_BYTES + i * G2POINT_BYTES);
  }

  return out;
}

export function trustedSetupBinToJson(bytes: TrustedSetupBin): TrustedSetupJSON {
  const data: TrustedSetupJSON = {
    setup_G1: [],
    setup_G2: [],
  };

  if (bytes.length < TOTAL_SIZE) {
    throw Error(`trusted_setup size ${bytes.length} < ${TOTAL_SIZE}`);
  }

  for (let i = 0; i < G1POINT_COUNT; i++) {
    const start = 2 * POINT_COUNT_BYTES + i * G1POINT_BYTES;
    data.setup_G1.push(toHex(bytes.slice(start, start + G1POINT_BYTES)));
  }

  for (let i = 0; i < G2POINT_COUNT; i++) {
    const start = 2 * POINT_COUNT_BYTES + G1POINT_COUNT * G1POINT_BYTES + i * G2POINT_BYTES;
    data.setup_G1.push(toHex(bytes.slice(start, start + G2POINT_BYTES)));
  }

  return data;
}

export function trustedSetupJsonToTxt(data: TrustedSetupJSON): TrustedSetupTXT {
  return [
    // ↵
    G1POINT_COUNT,
    G2POINT_COUNT,
    ...data.setup_G1.map(strip0xPrefix),
    ...data.setup_G2.map(strip0xPrefix),
  ].join("\n");
}

function strip0xPrefix(hex: string): string {
  if (hex.startsWith("0x")) {
    return hex.slice(2);
  } else {
    return hex;
  }
}
