import {ByteVector, fromHexString, toHexString} from "@chainsafe/ssz";
import {ErrorParseJson} from "./jsonRpcHttpClient";

/* eslint-disable @typescript-eslint/naming-convention */

export const rootHexRegex = /^0x[a-fA-F0-9]{64}$/;

export function numberToHex(n: number | bigint): string {
  return "0x" + n.toString(16);
}

export function isJsonRpcTruncatedError(error: Error): boolean {
  return (
    // Truncated responses usually get as 200 but since it's truncated the JSON will be invalid
    error instanceof ErrorParseJson ||
    // Otherwise guess Infura error message of too many events
    (error instanceof Error && error.message.includes("query returned more than 10000 results"))
  );
}

/** Safe parser of hex decimal positive integers */
export function hexToNumber(hex: string, id = ""): number {
  const num = parseInt(hex, 16);
  if (isNaN(num) || num < 0) throw Error(`Invalid hex decimal ${id} '${hex}'`);
  return num;
}

/** Typesafe fn to convert hex string to bigint. The BigInt constructor param is any */
export function hexToBigint(hex: string, id = ""): bigint {
  try {
    return BigInt(hex);
  } catch (e) {
    throw Error(`Invalid hex bigint ${id} '${hex}': ${(e as Error).message}`);
  }
}

export function validateHexRoot(hex: string, id = ""): void {
  if (!rootHexRegex.test(hex)) throw Error(`Invalid hex root ${id} '${hex}'`);
}

export function hexToBytes(hex: string): Uint8Array {
  // Handle special case in Ethereum hex formating where hex values may include a single letter
  // 0x0, 0x1 are valid values
  if (hex.length === 3 && hex.startsWith("0x")) {
    hex = "0x0" + hex[2];
  }

  try {
    return fromHexString(hex);
  } catch (e) {
    (e as Error).message = `Invalid hex string: ${(e as Error).message}`;
    throw e;
  }
}

export function bytesToHex(bytes: Uint8Array | ByteVector): string {
  // Handle special case in Ethereum hex formating where hex values may include a single letter
  // 0x0, 0x1 are valid values
  if (bytes.length === 1 && bytes[0] <= 0xf) {
    return "0x" + bytes[0].toString(16);
  }

  return toHexString(bytes);
}
