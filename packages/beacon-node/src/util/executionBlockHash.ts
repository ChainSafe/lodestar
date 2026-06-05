import {createMPT} from "@ethereumjs/mpt";
import {RLP} from "@ethereumjs/rlp";
import {sha256} from "@noble/hashes/sha2.js";
import {keccak_256} from "@noble/hashes/sha3.js";
import {CONSOLIDATION_REQUEST_TYPE, DEPOSIT_REQUEST_TYPE, WITHDRAWAL_REQUEST_TYPE} from "@lodestar/params";
import {capella, electra, gloas, ssz} from "@lodestar/types";

/**
 * Pre-image of `keccak256(rlp([]))` — the canonical post-merge `sha3Uncles` value.
 */
const EMPTY_UNCLE_HASH = Uint8Array.from([
  0x1d, 0xcc, 0x4d, 0xe8, 0xde, 0xc7, 0x5d, 0x7a, 0xab, 0x85, 0xb5, 0x67, 0xb6, 0xcc, 0xd4, 0x1a, 0xd3, 0x12, 0x45,
  0x1b, 0x94, 0x8a, 0x74, 0x13, 0xf0, 0xa1, 0x42, 0xfd, 0x40, 0xd4, 0x93, 0x47,
]);
const POST_MERGE_NONCE = new Uint8Array(8);
const RLP_ZERO = new Uint8Array(0);

/**
 * Canonical root of an empty Merkle-Patricia trie: `keccak256(rlp(0x80))`.
 * Returned directly when the trie has no entries to avoid spinning up a fresh MPT.
 */
const EMPTY_TRIE_ROOT = Uint8Array.from([
  0x56, 0xe8, 0x1f, 0x17, 0x1b, 0xcc, 0x55, 0xa6, 0xff, 0x83, 0x45, 0xe6, 0x92, 0xc0, 0xf8, 0x6e, 0x5b, 0x48, 0xe0,
  0x1b, 0x99, 0x6c, 0xad, 0xc0, 0x01, 0x62, 0x2f, 0xb5, 0xe3, 0x63, 0xb4, 0x21,
]);

function uintToBytes(n: number | bigint): Uint8Array {
  let bn = typeof n === "bigint" ? n : BigInt(n);
  if (bn === 0n) return RLP_ZERO;
  const bytes: number[] = [];
  while (bn > 0n) {
    bytes.unshift(Number(bn & 0xffn));
    bn >>= 8n;
  }
  return new Uint8Array(bytes);
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrs) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

async function indexedTrieRoot(values: Uint8Array[]): Promise<Uint8Array> {
  if (values.length === 0) return EMPTY_TRIE_ROOT;
  const trie = await createMPT();
  for (let i = 0; i < values.length; i++) {
    await trie.put(RLP.encode(i), values[i]);
  }
  return trie.root();
}

function rlpEncodeWithdrawal(w: capella.Withdrawal): Uint8Array {
  return RLP.encode([uintToBytes(w.index), uintToBytes(w.validatorIndex), w.address, uintToBytes(w.amount)]);
}

function prefixType(bytes: Uint8Array, type: number): Uint8Array {
  const out = new Uint8Array(1 + bytes.length);
  out[0] = type;
  out.set(bytes, 1);
  return out;
}

/**
 * Serialize an SSZ `ExecutionRequests` container into the per-type byte buffers
 * (each prefixed by its single-byte type tag) defined by EIP-7685's
 * `get_execution_requests_list`. Empty request lists are omitted.
 */
export function serializeExecutionRequestsBytes(executionRequests: electra.ExecutionRequests): Uint8Array[] {
  const {deposits, withdrawals, consolidations} = executionRequests;
  const out: Uint8Array[] = [];
  if (deposits.length !== 0) {
    out.push(prefixType(ssz.electra.DepositRequests.serialize(deposits), DEPOSIT_REQUEST_TYPE));
  }
  if (withdrawals.length !== 0) {
    out.push(prefixType(ssz.electra.WithdrawalRequests.serialize(withdrawals), WITHDRAWAL_REQUEST_TYPE));
  }
  if (consolidations.length !== 0) {
    out.push(prefixType(ssz.electra.ConsolidationRequests.serialize(consolidations), CONSOLIDATION_REQUEST_TYPE));
  }
  return out;
}

/**
 * EIP-7685 `requests_hash = sha256( sha256(req_1) || sha256(req_2) || ... )`.
 * For an empty list, this is `sha256("")`.
 */
export function computeExecutionRequestsHash(serializedRequests: Uint8Array[]): Uint8Array {
  const inner = serializedRequests.map((req) => sha256(req));
  return sha256(concatBytes(...inner));
}

/**
 * Pre-computed fields needed to RLP-encode the EL block header. Public surface
 * for unit testing against externally-known transactionsRoot/withdrawalsRoot
 * values (e.g. from `eth_getBlockByNumber`).
 */
export type ExecutionHeaderFields = {
  parentHash: Uint8Array;
  feeRecipient: Uint8Array;
  stateRoot: Uint8Array;
  transactionsRoot: Uint8Array;
  receiptsRoot: Uint8Array;
  logsBloom: Uint8Array;
  blockNumber: number | bigint;
  gasLimit: number | bigint;
  gasUsed: number | bigint;
  timestamp: number | bigint;
  extraData: Uint8Array;
  prevRandao: Uint8Array;
  baseFeePerGas: bigint;
  withdrawalsRoot: Uint8Array;
  blobGasUsed: number | bigint;
  excessBlobGas: number | bigint;
  parentBeaconBlockRoot: Uint8Array;
  requestsHash: Uint8Array;
};

/**
 * RLP-encode the post-Prague EL block header and apply keccak256.
 *
 * Field order follows the EL block header schema as of Prague:
 *   parentHash, sha3Uncles, miner (fee_recipient), stateRoot,
 *   transactionsRoot, receiptsRoot, logsBloom, difficulty (=0),
 *   number, gasLimit, gasUsed, timestamp, extraData,
 *   mixHash (prev_randao), nonce (=0x00…00),
 *   baseFeePerGas, withdrawalsRoot,
 *   blobGasUsed, excessBlobGas, parentBeaconBlockRoot, requestsHash
 */
export function rlpEncodeAndHashHeader(h: ExecutionHeaderFields): Uint8Array {
  const fields: Uint8Array[] = [
    h.parentHash,
    EMPTY_UNCLE_HASH,
    h.feeRecipient,
    h.stateRoot,
    h.transactionsRoot,
    h.receiptsRoot,
    h.logsBloom,
    RLP_ZERO,
    uintToBytes(h.blockNumber),
    uintToBytes(h.gasLimit),
    uintToBytes(h.gasUsed),
    uintToBytes(h.timestamp),
    h.extraData,
    h.prevRandao,
    POST_MERGE_NONCE,
    uintToBytes(h.baseFeePerGas),
    h.withdrawalsRoot,
    uintToBytes(h.blobGasUsed),
    uintToBytes(h.excessBlobGas),
    h.parentBeaconBlockRoot,
    h.requestsHash,
  ];
  return keccak_256(RLP.encode(fields));
}

export type ExecutionBlockHashInput = {
  payload: electra.ExecutionPayload | gloas.ExecutionPayload;
  parentBeaconBlockRoot: Uint8Array;
  executionRequests: electra.ExecutionRequests;
};

/**
 * Reconstruct the post-Pectra execution-layer block header from a CL
 * `ExecutionPayload`, RLP-encode it, and return `keccak256(rlp(header))`.
 *
 * This is the recompute that `executionPayloadEnvelope` gossip validation uses
 * to defend against the PTC payload-equivocation case in
 * https://github.com/ethereum/consensus-specs/issues/5333.
 *
 * NOTE: header layout for Gloas-specific fields (e.g. `block_access_list_root`
 * per EIP-7928) is not yet settled in execution-specs; this function currently
 * encodes the Prague-shape header. Extend here once the Gloas EL header schema
 * lands.
 */
export async function computeExecutionBlockHash(input: ExecutionBlockHashInput): Promise<Uint8Array> {
  const {payload, parentBeaconBlockRoot, executionRequests} = input;

  const [transactionsRoot, withdrawalsRoot] = await Promise.all([
    indexedTrieRoot(payload.transactions),
    indexedTrieRoot(payload.withdrawals.map(rlpEncodeWithdrawal)),
  ]);
  const requestsHash = computeExecutionRequestsHash(serializeExecutionRequestsBytes(executionRequests));

  return rlpEncodeAndHashHeader({
    parentHash: payload.parentHash,
    feeRecipient: payload.feeRecipient,
    stateRoot: payload.stateRoot,
    transactionsRoot,
    receiptsRoot: payload.receiptsRoot,
    logsBloom: payload.logsBloom,
    blockNumber: payload.blockNumber,
    gasLimit: payload.gasLimit,
    gasUsed: payload.gasUsed,
    timestamp: payload.timestamp,
    extraData: payload.extraData,
    prevRandao: payload.prevRandao,
    baseFeePerGas: payload.baseFeePerGas,
    withdrawalsRoot,
    blobGasUsed: payload.blobGasUsed,
    excessBlobGas: payload.excessBlobGas,
    parentBeaconBlockRoot,
    requestsHash,
  });
}
