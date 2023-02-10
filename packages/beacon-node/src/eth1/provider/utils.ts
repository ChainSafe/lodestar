import {RootHex} from "@lodestar/types";
import {bytesToBigInt, bigIntToBytes} from "@lodestar/utils";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ErrorParseJson} from "./jsonRpcHttpClient.js";

/** QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API */
export type QUANTITY = string;
/** DATA as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API */
export type DATA = string;

export const rootHexRegex = /^0x[a-fA-F0-9]{64}$/;

export function numberToHex(n: number | bigint): string {
  return "0x" + n.toString(16);
}

export function isJsonRpcTruncatedError(error: Error): boolean {
  return (
    // Truncated responses usually get as 200 but since it's truncated the JSON will be invalid
    error instanceof ErrorParseJson ||
    // Otherwise guess Infura error message of too many events
    (error instanceof Error && error.message.includes("query returned more than 10000 results")) ||
    // Nethermind enforces limits on JSON RPC batch calls
    (error instanceof Error && error.message.toLowerCase().includes("batch size limit exceeded"))
  );
}

export function bytesToHex(bytes: Uint8Array): string {
  // Handle special case in Ethereum hex formating where hex values may include a single letter
  // 0x0, 0x1 are valid values
  if (bytes.length === 1 && bytes[0] <= 0xf) {
    return "0x" + bytes[0].toString(16);
  }

  return toHexString(bytes);
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 *
 * When encoding QUANTITIES (integers, numbers): encode as hex, prefix with “0x”, the most compact representation (slight exception: zero should be represented as “0x0”). Examples:
 * - 0x41 (65 in decimal)
 * - 0x400 (1024 in decimal)
 * - WRONG: 0x (should always have at least one digit - zero is “0x0”)
 * - WRONG: 0x0400 (no leading zeroes allowed)
 * - WRONG: ff (must be prefixed 0x)
 */
export function numToQuantity(num: number | bigint): QUANTITY {
  return "0x" + num.toString(16);
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 */
export function quantityToNum(hex: QUANTITY, id = ""): number {
  const num = parseInt(hex, 16);
  if (isNaN(num) || num < 0) throw Error(`Invalid hex decimal ${id} '${hex}'`);
  return num;
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API.
 * Typesafe fn to convert hex string to bigint. The BigInt constructor param is any
 */
export function quantityToBigint(hex: QUANTITY, id = ""): bigint {
  try {
    return BigInt(hex);
  } catch (e) {
    throw Error(`Invalid hex bigint ${id} '${hex}': ${(e as Error).message}`);
  }
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API.
 */
export function quantityToBytes(hex: QUANTITY): Uint8Array {
  const bn = quantityToBigint(hex);
  return bigIntToBytes(bn, 32, "le");
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API.
 * Compress a 32 ByteVector into a QUANTITY
 */
export function bytesToQuantity(bytes: Uint8Array): QUANTITY {
  const bn = bytesToBigInt(bytes as Uint8Array, "le");
  return numToQuantity(bn);
}

/**
 * DATA as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 *
 * When encoding UNFORMATTED DATA (byte arrays, account addresses, hashes, bytecode arrays): encode as hex, prefix with
 * “0x”, two hex digits per byte. Examples:
 *
 * - 0x41 (size 1, “A”)
 * - 0x004200 (size 3, “\0B\0”)
 * - 0x (size 0, “”)
 * - WRONG: 0xf0f0f (must be even number of digits)
 * - WRONG: 004200 (must be prefixed 0x)
 */
export function bytesToData(bytes: Uint8Array): DATA {
  return toHexString(bytes);
}

/**
 * DATA as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 */
export function dataToBytes(hex: DATA, fixedLength: number | null): Uint8Array {
  try {
    const bytes = fromHexString(hex);
    if (fixedLength != null && bytes.length !== fixedLength) {
      throw Error(`Wrong data length ${bytes.length} expected ${fixedLength}`);
    }
    return bytes;
  } catch (e) {
    (e as Error).message = `Invalid hex string: ${(e as Error).message}`;
    throw e;
  }
}

/**
 * DATA as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 */
export function dataToRootHex(hex: DATA, id = ""): RootHex {
  if (!rootHexRegex.test(hex)) throw Error(`Invalid hex root ${id} '${hex}'`);
  return hex;
}
