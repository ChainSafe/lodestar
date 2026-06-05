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

  UNKNOWN_DATA = "unknown_data",
}

export enum PendingBlockInputStatus {
  pending = "pending",
  fetching = "fetching",
  downloaded = "downloaded",
  processing = "processing",
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

  return "unknown";
}
