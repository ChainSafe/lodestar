import {RootHex, Slot} from "@lodestar/types";
import {SignedExecutionPayloadEnvelope} from "@lodestar/types/gloas";
import {toRootHex} from "@lodestar/utils";
import {IBlockInput} from "../chain/blocks/blockInput/index.js";
import {PayloadEnvelopeInput} from "../chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";

export enum PendingBlockType {
  /**
   * We got a block root (from a gossip attestation, for exxample) but we don't have the block in forkchoice.
   */
  UNKNOWN_BLOCK_ROOT = "UnknownBlockRoot",
  /**
   * During gossip time, we may get a block but the parent root is unknown (not in forkchoice).
   */
  UNKNOWN_PARENT = "unknown_parent",
  /**
   * During gossip we wait for a set amount of time to receive the complete block input but if it does not
   * arrive in time we turn to req/resp to pull the remainder so that it can be processed
   */
  INCOMPLETE_BLOCK_INPUT = "IncompleteBlockInput",

  /**
   * Payload analog of UNKNOWN_BLOCK_ROOT: we have a beacon block root but not its execution payload envelope.
   */
  UNKNOWN_PAYLOAD_BLOCK_ROOT = "unknown_payload_block_root",
  /**
   * Same as UNKNOWN_PAYLOAD_BLOCK_ROOT, but the trigger also carries the payload's slot
   */
  UNKNOWN_PAYLOAD_BLOCK_ROOT_SLOT = "unknown_payload_block_root_slot",
  /**
   * Same as UNKNOWN_PAYLOAD_BLOCK_ROOT_SLOT for the current slot
   */
  DEFERRED_PAYLOAD_BLOCK_ROOT = "deferred_payload_block_root",
  /**
   * Payload analog of INCOMPLETE_BLOCK_INPUT: we have a partial payload input that did not complete in time.
   */
  INCOMPLETE_PAYLOAD_ENVELOPE = "incomplete_payload_envelope",
}

export enum DownloadResult {
  /** payload fully downloaded, ready to process */
  Resolved = "resolved",
  /** payload fully downloaded, but it was already imported (via gossip) while we were downloading */
  Late = "late",
  /** envelope downloaded, held until the block lands in fork choice */
  WaitingForBlock = "waiting_for_block",
  /** fetch failed, the pending entry is retained for retry */
  Failed = "failed",
}

export enum FetchResult {
  SuccessResolved = "success_resolved",
  SuccessMissingParent = "success_missing_parent",
  SuccessLate = "success_late",
  SuccessWaitingForBlock = "success_waiting_for_block",
  FailureTriedAllPeers = "failure_tried_all_peers",
  FailureMaxAttempts = "failure_max_attempts",
}

/**
 * Outcome of a slot's deferred optimistic payload searches, recorded once when its poll loop ends.
 */
export enum DeferredPayloadResult {
  /** gossip delivered every watched payload before PAYLOAD_DUE, no search was needed */
  ImportedBeforeSearch = "imported_before_search",
  /** at least one was missing at PAYLOAD_DUE, we searched, and all were imported afterwards */
  ImportedAfterSearch = "imported_after_search",
  /** something was still not in fork choice when the slot ended */
  Unresolved = "unresolved",
  /** the slot had no optimistic search and no payload import at all, eg a skipped slot */
  ResolvedNoRoot = "resolved_no_root",
}

export enum PendingBlockInputStatus {
  pending = "pending",
  fetching = "fetching",
  downloaded = "downloaded",
  processing = "processing",
}

/**
 * Why a pending item was dropped from BlockInputSync WITHOUT completing.
 * The happy path — a successfully imported/processed block or payload — is removed by the import
 * flow (onPayloadImported, processReadyBlock/processPayload success) and is deliberately NOT tracked
 * here
 */
export enum DroppedItemReason {
  /** prune: item's own slot is below the finalized slot (routine cleanup), or a downloaded block landed at/below finality */
  belowFinalized = "below_finalized",
  /** prune: slot-less, unresolvable payload evicted after PRUNE_UNRESOLVED_SLOT_EPOCHS */
  agedOut = "aged_out",
  /** pruneSetToMax evicted the oldest entry because the cache hit its capacity (DoS guard) */
  capacity = "capacity",
  /** descendant removed because an ancestor was invalid/removed */
  invalidParent = "invalid_parent",
  /** transient execution-engine error removal (EXECUTION_ENGINE_ERROR) */
  elError = "el_error",
  /** the execution engine declared the item invalid (EXECUTION_ENGINE_INVALID) */
  elInvalid = "el_invalid",
  /** a block failed our own checks (not correct w.r.t. our chain) */
  invalidBlock = "invalid_block",
  /** a block declares a parent payload hash that conflicts with the parent's actual payload (gloas) */
  invalidParentPayload = "invalid_parent_payload",
  /** a payload envelope failed gossip verification (ENVELOPE_VERIFICATION_ERROR) */
  invalidEnvelope = "invalid_envelope",
  /** a payload had an invalid signature (INVALID_SIGNATURE) */
  invalidSignature = "invalid_signature",
  /** a block root was given up on after exhausting download attempts (data could not be fetched) */
  unavailable = "unavailable",
  /** an unexpected / unhandled error code led to removal */
  unknown = "unknown",
}

export enum PendingPayloadInputStatus {
  pending = "pending",
  fetching = "fetching",
  waitingForBlock = "waiting_for_block",
  downloaded = "downloaded",
  processing = "processing",
}

export type PendingBlockInput = {
  status: PendingBlockInputStatus;
  blockInput: IBlockInput;
  timeAddedSec: number;
  timeSyncedSec?: number;
  peerIdStrings: Set<string>;
};

export type PendingRootHex = {
  status: PendingBlockInputStatus.pending | PendingBlockInputStatus.fetching;
  rootHex: RootHex;
  timeAddedSec: number;
  timeSyncedSec?: number;
  peerIdStrings: Set<string>;
};

export type BlockInputSyncCacheItem = PendingBlockInput | PendingRootHex;

export type PendingPayloadInput = {
  status:
    | PendingPayloadInputStatus.pending
    | PendingPayloadInputStatus.fetching
    | PendingPayloadInputStatus.downloaded
    | PendingPayloadInputStatus.processing;
  payloadInput: PayloadEnvelopeInput;
  timeAddedSec: number;
  timeSyncedSec?: number;
  peerIdStrings: Set<string>;
};

export type PendingPayloadRootHex = {
  status: PendingPayloadInputStatus.pending | PendingPayloadInputStatus.fetching;
  rootHex: RootHex;
  // slot could be via fork choice or ChainEvent.unknownEnvelopeBlockRootSlot
  // while ChainEvent.unknownEnvelopeBlockRoot does not provide one
  slot?: Slot;
  timeAddedSec: number;
  timeSyncedSec?: number;
  peerIdStrings: Set<string>;
};

export type PendingPayloadEnvelope = {
  status: PendingPayloadInputStatus.waitingForBlock;
  envelope: SignedExecutionPayloadEnvelope;
  timeAddedSec: number;
  peerIdStrings: Set<string>;
};

export type PayloadSyncCacheItem = PendingPayloadInput | PendingPayloadRootHex | PendingPayloadEnvelope;

export function isPendingBlockInput(pending: BlockInputSyncCacheItem): pending is PendingBlockInput {
  return "blockInput" in pending;
}

export function isPendingPayloadInput(pending: PayloadSyncCacheItem): pending is PendingPayloadInput {
  return "payloadInput" in pending;
}

export function isPendingPayloadEnvelope(pending: PayloadSyncCacheItem): pending is PendingPayloadEnvelope {
  return "envelope" in pending;
}

export function getBlockInputSyncCacheItemRootHex(block: BlockInputSyncCacheItem): RootHex {
  return isPendingBlockInput(block) ? block.blockInput.blockRootHex : block.rootHex;
}

export function getBlockInputSyncCacheItemSlot(block: BlockInputSyncCacheItem): Slot | string {
  return isPendingBlockInput(block) ? block.blockInput.slot : "unknown";
}

export function getPayloadSyncCacheItemRootHex(payload: PayloadSyncCacheItem): RootHex {
  if (isPendingPayloadInput(payload)) {
    return payload.payloadInput.blockRootHex;
  }

  if (isPendingPayloadEnvelope(payload)) {
    return toRootHex(payload.envelope.message.beaconBlockRoot);
  }

  return payload.rootHex;
}

export function getPayloadSyncCacheItemSlot(payload: PayloadSyncCacheItem): Slot | string {
  if (isPendingPayloadInput(payload)) {
    return payload.payloadInput.slot;
  }

  if (isPendingPayloadEnvelope(payload)) {
    return payload.envelope.message.payload.slotNumber;
  }

  return payload.slot ?? "unknown";
}
