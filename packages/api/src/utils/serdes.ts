import {JsonPath} from "@chainsafe/ssz";
import {fromHex, toHex} from "@lodestar/utils";

/**
 * Serialize proof path to JSON.
 * @param paths `[["finalized_checkpoint", 0, "root", 12000]]`
 * @returns `['["finalized_checkpoint",0,"root",12000]']`
 */
export function querySerializeProofPathsArr(paths: JsonPath[]): string[] {
  return paths.map((path) => JSON.stringify(path));
}

/**
 * Deserialize JSON proof path to proof path
 * @param pathStrs `['["finalized_checkpoint",0,"root",12000]']`
 * @returns `[["finalized_checkpoint", 0, "root", 12000]]`
 */
export function queryParseProofPathsArr(pathStrs: string | string[]): JsonPath[] {
  if (Array.isArray(pathStrs)) {
    return pathStrs.map((pathStr) => queryParseProofPaths(pathStr));
  } else {
    return [queryParseProofPaths(pathStrs)];
  }
}

/**
 * Deserialize single JSON proof path to proof path
 * @param pathStr `'["finalized_checkpoint",0,"root",12000]'`
 * @returns `["finalized_checkpoint", 0, "root", 12000]`
 */
export function queryParseProofPaths(pathStr: string): JsonPath {
  const path = JSON.parse(pathStr) as JsonPath;

  if (!Array.isArray(path)) {
    throw Error("Proof pathStr is not an array");
  }

  for (let i = 0; i < path.length; i++) {
    const elType = typeof path[i];
    if (elType !== "string" && elType !== "number") {
      throw Error(`Proof pathStr[${i}] not string or number`);
    }
  }

  return path;
}

export type U64 = number;
export type U64Str = string;

export function fromU64Str(u64Str: U64Str): number {
  const u64 = parseInt(u64Str, 10);
  if (!Number.isFinite(u64)) {
    throw Error(`Invalid uin64 ${u64Str}`);
  }
  return u64;
}

export function toU64Str(u64: U64): U64Str {
  return u64.toString(10);
}

export function fromU64StrOpt(u64Str: U64Str | undefined): U64 | undefined {
  return u64Str !== undefined ? fromU64Str(u64Str) : undefined;
}

export function toU64StrOpt(u64: U64 | undefined): U64Str | undefined {
  return u64 !== undefined ? toU64Str(u64) : undefined;
}

export function toValidatorIdsStr(ids?: (string | number)[]): string[] | undefined {
  return ids?.map((id) => (typeof id === "string" ? id : toU64Str(id)));
}

export function fromValidatorIdsStr(ids?: string[]): (string | number)[] | undefined {
  return ids?.map((id) => (typeof id === "string" && id.startsWith("0x") ? id : fromU64Str(id)));
}

const GRAFFITI_HEX_LENGTH = 66;

export function toGraffitiHex(utf8?: string): string | undefined {
  if (utf8 === undefined) {
    return undefined;
  }

  const hex = toHex(new TextEncoder().encode(utf8));

  if (hex.length > GRAFFITI_HEX_LENGTH) {
    // remove characters from the end if hex string is too long
    return hex.slice(0, GRAFFITI_HEX_LENGTH);
  }

  if (hex.length < GRAFFITI_HEX_LENGTH) {
    // right-pad with zeros if hex string is too short
    return hex.padEnd(GRAFFITI_HEX_LENGTH, "0");
  }

  return hex;
}

export function fromGraffitiHex(hex?: string): string | undefined {
  if (hex === undefined) {
    return undefined;
  }
  try {
    return new TextDecoder("utf8").decode(fromHex(hex));
  } catch (_e) {
    // allow malformed graffiti hex string
    return hex;
  }
}

export function toBoolean(value: string): boolean {
  value = value.toLowerCase();

  if (value !== "true" && value !== "false") {
    throw Error(`Invalid boolean ${value}`);
  }

  return value === "true";
}
