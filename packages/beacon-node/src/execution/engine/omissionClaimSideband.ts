import {readFileSync} from "node:fs";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";

/** EIP-8369 omission claim as sent over JSON-RPC: transaction hash plus QUANTITY evaluation index */
export type OmissionClaimRpc = {transactionHash: string; evaluationIndex: string};

const MAX_ENTRIES = 256;

const omissionClaimsByBlockHash = new Map<string, OmissionClaimRpc[]>();
const inclusionListsByBlockHash = new Map<string, Uint8Array[][]>();

function setBounded<T>(map: Map<string, T>, key: string, value: T): void {
  map.set(key.toLowerCase(), value);
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function recordOmissionClaims(blockHash: string, claims: OmissionClaimRpc[]): void {
  setBounded(omissionClaimsByBlockHash, blockHash, claims);
}

export function getOmissionClaims(blockHash: string): OmissionClaimRpc[] {
  return omissionClaimsByBlockHash.get(blockHash.toLowerCase()) ?? [];
}

export function recordInclusionLists(blockHash: string, lists: Uint8Array[][]): void {
  setBounded(inclusionListsByBlockHash, blockHash, lists);
}

export function getInclusionLists(blockHash: string): Uint8Array[][] | undefined {
  return inclusionListsByBlockHash.get(blockHash.toLowerCase());
}

const VERDICT_POLL_INTERVAL_MS = 100;
const VERDICT_POLL_ATTEMPTS = 40;

/** Polls engine_getInclusionListVerdictV1 until the EL returns a verdict, null when it stays pending */
export async function pollInclusionListVerdict(
  engine: {getInclusionListVerdict(inclusionCheckId: string): Promise<boolean | null>},
  inclusionCheckId: string,
  intervalMs = VERDICT_POLL_INTERVAL_MS,
  attempts = VERDICT_POLL_ATTEMPTS
): Promise<boolean | null> {
  for (let i = 0; i < attempts; i++) {
    const verdict = await engine.getInclusionListVerdict(inclusionCheckId);
    if (verdict !== null) return verdict;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

export function emptyInclusionLists(): Uint8Array[][] {
  return Array.from({length: INCLUSION_LIST_COMMITTEE_SIZE}, () => []);
}

export function listsFromFlat(transactions: Iterable<Uint8Array>): Uint8Array[][] {
  const lists = emptyInclusionLists();
  lists[0] = Array.from(transactions);
  return lists;
}

/**
 * Devnet positive control: raw transactions listed (one hex string per line) in the file named by
 * FOCIL_DEV_EXTRA_IL_TXS are added to committee position 0 at verification time only, so the
 * builder never saw them and the payload omits them.
 */
export function devExtraInclusionListTxs(): Uint8Array[] {
  const path = process.env.FOCIL_DEV_EXTRA_IL_TXS;
  if (!path) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return text
    .split(/\s+/)
    .map((line) => line.trim().replace(/^0x/, ""))
    .filter((hex) => hex.length > 0 && hex.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(hex))
    .map((hex) => Uint8Array.from(Buffer.from(hex, "hex")));
}
