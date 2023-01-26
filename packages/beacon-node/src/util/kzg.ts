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
  loadTrustedSetup(filePath: string): void;
  blobToKzgCommitment(blob: Uint8Array): Uint8Array;
  computeAggregateKzgProof(blobs: Uint8Array[]): Uint8Array;
  verifyAggregateKzgProof(
    blobs: Uint8Array[],
    expectedKzgCommitments: Uint8Array[],
    kzgAggregatedProof: Uint8Array
  ): boolean;
} = {
  freeTrustedSetup: ckzgNotLoaded,
  loadTrustedSetup: ckzgNotLoaded,
  blobToKzgCommitment: ckzgNotLoaded,
  computeAggregateKzgProof: ckzgNotLoaded,
  verifyAggregateKzgProof: ckzgNotLoaded,
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
  /* eslint-disable import/no-extraneous-dependencies, @typescript-eslint/ban-ts-comment */
  // @ts-ignore
  ckzg = (await import("c-kzg")) as typeof ckzg;
  /* eslint-enable import/no-extraneous-dependencies, @typescript-eslint/ban-ts-comment */
}

/**
 * Load our KZG trusted setup into C-KZG for later use.
 * We persist the trusted setup as serialized bytes to save space over TXT or JSON formats.
 * However the current c-kzg API **requires** to read from a file with a specific .txt format
 */
export function loadEthereumTrustedSetup(): void {
  try {
    const bytes = fs.readFileSync(TRUSTED_SETUP_BIN_FILEPATH);
    const json = trustedSetupBinToJson(bytes);
    const txt = trustedSetupJsonToTxt(json);
    fs.writeFileSync(TRUSTED_SETUP_TXT_FILEPATH, txt);

    try {
      // in unit tests, calling loadTrustedSetup() twice has error so we have to free and retry
      ckzg.loadTrustedSetup(TRUSTED_SETUP_TXT_FILEPATH);
    } catch (e) {
      if ((e as Error).message === "Call freeTrustedSetup before loading a new trusted setup.") {
        ckzg.freeTrustedSetup();
        ckzg.loadTrustedSetup(TRUSTED_SETUP_TXT_FILEPATH);
      } else {
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
