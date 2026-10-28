import {Input, RLP} from "@ethereumjs/rlp";
import {keccak256} from "ethereum-cryptography/keccak.js";
import {digest as sha256} from "@chainsafe/as-sha256";
import {ForkPostBellatrix, ForkSeq} from "@lodestar/params";
import {ExecutionPayload, ExecutionRequests, Root, capella, deneb, gloas} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {serializeExecutionRequestsToBytes} from "./types.js";

/** keccak256(rlp([])), the ommers hash of every post-merge block */
const EMPTY_OMMERS_HASH = fromHex("0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347");
const ZERO_NONCE = new Uint8Array(8);

/**
 * Compute the execution block hash of `payload`: keccak256 of the RLP-encoded execution block header,
 * with the header fields laid out as in execution-specs for the execution fork paired with `fork`.
 *
 * `parentBeaconBlockRoot` is required from deneb and `executionRequests` from electra.
 */
export function computeExecutionBlockHash(
  fork: ForkPostBellatrix,
  payload: ExecutionPayload,
  parentBeaconBlockRoot: Root | null,
  executionRequests: ExecutionRequests | null
): Uint8Array {
  const forkSeq = ForkSeq[fork];
  // Field order follows `class Header` in execution-specs `src/ethereum/forks/<el_fork>/blocks.py` @ 7f2f4c9:
  // bellatrix=paris, capella=shanghai, deneb=cancun, electra=prague, fulu=osaka, gloas=amsterdam.
  // Each fork only appends fields to the previous one.
  const fields: Input[] = [
    payload.parentHash,
    EMPTY_OMMERS_HASH,
    payload.feeRecipient,
    payload.stateRoot,
    computeOrderedTrieRoot(payload.transactions.toArray()),
    payload.receiptsRoot,
    payload.logsBloom,
    // difficulty
    0,
    payload.blockNumber,
    payload.gasLimit,
    payload.gasUsed,
    payload.timestamp,
    payload.extraData,
    // mix_hash
    payload.prevRandao,
    ZERO_NONCE,
    payload.baseFeePerGas,
  ];

  // EIP-4895 withdrawals_root
  if (forkSeq >= ForkSeq.capella) {
    const {withdrawals} = payload as capella.ExecutionPayload;
    fields.push(computeOrderedTrieRoot(withdrawals.map(encodeWithdrawal)));
  }

  // EIP-4844 blob_gas_used, excess_blob_gas, EIP-4788 parent_beacon_block_root
  if (forkSeq >= ForkSeq.deneb) {
    if (parentBeaconBlockRoot === null) {
      throw Error(`parentBeaconBlockRoot is required to compute the block hash for fork=${fork}`);
    }
    const {blobGasUsed, excessBlobGas} = payload as deneb.ExecutionPayload;
    fields.push(blobGasUsed, excessBlobGas, parentBeaconBlockRoot);
  }

  // EIP-7685 requests_hash
  if (forkSeq >= ForkSeq.electra) {
    if (executionRequests === null) {
      throw Error(`executionRequests is required to compute the block hash for fork=${fork}`);
    }
    fields.push(computeRequestsHash(serializeExecutionRequestsToBytes(fork, executionRequests)));
  }

  // EIP-7928 block_access_list_hash, EIP-7843 slot_number
  if (forkSeq >= ForkSeq.gloas) {
    const {blockAccessList, slotNumber} = payload as gloas.ExecutionPayload;
    // The block access list is already RLP-encoded, so it is hashed as is
    fields.push(keccak256(blockAccessList), slotNumber);
  }

  return keccak256(RLP.encode(fields));
}

/**
 * Root of the Merkle-Patricia trie keyed by `rlp(index)` over `items`, as used for the
 * transactions and withdrawals roots of an execution block header.
 */
export function computeOrderedTrieRoot(items: Uint8Array[]): Uint8Array {
  const entries: TrieEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    // Setting an empty value in the trie is a deletion
    if (items[i].length > 0) {
      entries.push({key: toNibbles(RLP.encode(i)), value: items[i]});
    }
  }
  if (entries.length === 0) {
    return keccak256(RLP.encode(new Uint8Array(0)));
  }
  entries.sort((a, b) => compareNibbles(a.key, b.key));
  return keccak256(RLP.encode(trieNode(entries, 0)));
}

/** EIP-7685 requests hash over type-prefixed, non-empty request lists */
function computeRequestsHash(requestsList: Uint8Array[]): Uint8Array {
  const hashes = new Uint8Array(32 * requestsList.length);
  for (let i = 0; i < requestsList.length; i++) {
    hashes.set(sha256(requestsList[i]), 32 * i);
  }
  return sha256(hashes);
}

/** Field order follows `class Withdrawal` in execution-specs `src/ethereum/forks/shanghai/blocks.py` */
function encodeWithdrawal(withdrawal: capella.Withdrawal): Uint8Array {
  return RLP.encode([withdrawal.index, withdrawal.validatorIndex, withdrawal.address, withdrawal.amount]);
}

type TrieEntry = {key: Uint8Array; value: Uint8Array};

/**
 * The trie node holding `entries`, which are sorted and share their first `depth` nibbles.
 */
function trieNode(entries: TrieEntry[], depth: number): Input[] {
  if (entries.length === 1) {
    const {key, value} = entries[0];
    return [encodeHexPrefix(key.subarray(depth), true), value];
  }

  // Sorted, so the common prefix of all keys is the common prefix of the first and last
  const first = entries[0].key;
  const last = (entries.at(-1) as TrieEntry).key;
  let prefixEnd = depth;
  while (prefixEnd < first.length && prefixEnd < last.length && first[prefixEnd] === last[prefixEnd]) {
    prefixEnd++;
  }
  if (prefixEnd > depth) {
    return [encodeHexPrefix(first.subarray(depth, prefixEnd), false), trieNodeReference(trieNode(entries, prefixEnd))];
  }

  const branch: Input[] = new Array(17).fill(new Uint8Array(0));
  let start = 0;
  if (first.length === depth) {
    branch[16] = entries[0].value;
    start = 1;
  }
  while (start < entries.length) {
    const nibble = entries[start].key[depth];
    let end = start + 1;
    while (end < entries.length && entries[end].key[depth] === nibble) {
      end++;
    }
    branch[nibble] = trieNodeReference(trieNode(entries.slice(start, end), depth + 1));
    start = end;
  }
  return branch;
}

/** Nodes shorter than 32 bytes are embedded in their parent, longer ones are referenced by hash */
function trieNodeReference(node: Input[]): Input {
  const encoded = RLP.encode(node);
  return encoded.length < 32 ? node : keccak256(encoded);
}

function encodeHexPrefix(nibbles: Uint8Array, isLeaf: boolean): Uint8Array {
  const flag = isLeaf ? 2 : 0;
  const isOdd = nibbles.length % 2 === 1;
  const out = new Uint8Array(Math.floor(nibbles.length / 2) + 1);
  let i = 0;
  if (isOdd) {
    out[0] = ((flag + 1) << 4) | nibbles[0];
    i = 1;
  } else {
    out[0] = flag << 4;
  }
  for (let j = 1; i < nibbles.length; i += 2, j++) {
    out[j] = (nibbles[i] << 4) | nibbles[i + 1];
  }
  return out;
}

function toNibbles(bytes: Uint8Array): Uint8Array {
  const nibbles = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    nibbles[2 * i] = bytes[i] >> 4;
    nibbles[2 * i + 1] = bytes[i] & 0x0f;
  }
  return nibbles;
}

function compareNibbles(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}
