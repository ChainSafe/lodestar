import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/blst";
import {fromHexString} from "@chainsafe/ssz";

/**
 * 0x prefix a string if not prefixed already
 */
export function ensure0xPrefix(hex: string): string {
  if (!hex.startsWith("0x")) hex = `0x${hex}`;
  return hex;
}

export function isValidatePubkeyHex(pubkeyHex: string): boolean {
  return /^0x[0-9a-fA-F]{96}$/.test(pubkeyHex);
}

export function getPubkeyHexFromKeystore(keystore: {pubkey?: string}): string {
  if (!keystore.pubkey) {
    throw Error("Invalid keystore, must contain .pubkey property");
  }

  const pubkeyHex = ensure0xPrefix(keystore.pubkey);
  if (!isValidatePubkeyHex(pubkeyHex)) {
    throw Error(`Invalid keystore pubkey format ${pubkeyHex}`);
  }

  return pubkeyHex;
}

/**
 * Parse string inclusive range: `0..32`, into an array of all values in that range
 */
export function parseRange(range: string): number[] {
  if (!range.includes("..")) {
    throw Error(`Invalid range '${range}', must include '..'`);
  }

  const [from, to] = range.split("..").map((n) => parseInt(n));

  if (isNaN(from)) throw Error(`Invalid range from isNaN '${range}'`);
  if (isNaN(to)) throw Error(`Invalid range to isNaN '${range}'`);
  if (from > to) throw Error(`Invalid range from > to '${range}'`);

  const arr: number[] = [];
  for (let i = from; i <= to; i++) {
    arr.push(i);
  }

  return arr;
}

export function assertValidPubkeysHex(pubkeysHex: string[]): void {
  for (const pubkeyHex of pubkeysHex) {
    const pubkeyBytes = fromHexString(pubkeyHex);
    bls.PublicKey.fromBytes(pubkeyBytes, CoordType.jacobian, true);
  }
}

export function isValidHttpUrl(urlStr: string): boolean {
  let url;
  try {
    url = new URL(urlStr);
  } catch (_) {
    return false;
  }

  return url.protocol === "http:" || url.protocol === "https:";
}

/**
 * Parses a file to get a list of bootnodes for a network.
 * Bootnodes file is expected to contain bootnode ENR's concatenated by newlines, or commas for
 * parsing plaintext, YAML, JSON and/or env files.
 */
export function parseBootnodesFile(bootnodesFile: string): string[] {
  const enrs = [];
  for (const line of bootnodesFile.trim().split(/\r?\n/)) {
    for (const entry of line.split(",")) {
      const sanitizedEntry = entry.replace(/['",[\]{}.]+/g, "").trim();

      if (sanitizedEntry.includes("enr:-")) {
        const parsedEnr = `enr:-${sanitizedEntry.split("enr:-")[1]}`;
        enrs.push(parsedEnr);
      }
    }
  }
  return enrs;
}
