import {RootHex, Slot} from "@lodestar/types";
import {IBlockInput} from "../chain/blocks/blockInput/index.js";

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
  // optional because we may not know the slot of parent_unknown event
  slot?: Slot;
  timeAddedSec: number;
  timeSyncedSec?: number;
  peerIdStrings: Set<string>;
};

export type BlockInputSyncCacheItem = PendingBlockInput | PendingRootHex;

export function isPendingBlockInput(pending: BlockInputSyncCacheItem): pending is PendingBlockInput {
  return "blockInput" in pending;
}

export function getBlockInputSyncCacheItemRootHex(block: BlockInputSyncCacheItem): RootHex {
  return isPendingBlockInput(block) ? block.blockInput.blockRootHex : block.rootHex;
}

export function getBlockInputSyncCacheItemSlot(block: BlockInputSyncCacheItem): Slot | string {
  return isPendingBlockInput(block) ? block.blockInput.slot : "unknown";
}
