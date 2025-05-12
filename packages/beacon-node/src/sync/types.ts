import {RootHex} from "@lodestar/types";
import {BlockInput} from "../chain/blocks/blockInput-mkeil/index.js";

export enum PendingBlockInputStatus {
  pending = "pending",
  fetching = "fetching",
  downloaded = "downloaded",
  processing = "processing",
}

export type PendingBlockInput = {
  status: PendingBlockInputStatus;
  blockInput: BlockInput;
  timeAddedSec: number;
  timeSyncedSec?: number;
  peerIdStrings: Set<string>;
};

export type PendingRootHex = {
  status: PendingBlockInputStatus;
  rootHex: RootHex;
  timeAddedSec: number;
  timeSyncedSec?: number;
  peerIdStrings: Set<string>;
};

export type BlockInputSyncCacheItem = PendingBlockInput | PendingRootHex;

export function isPendingBlockInput(pending: BlockInputSyncCacheItem): pending is PendingBlockInput {
  return "blockInput" in pending;
}

export function getBlockInputSyncCacheItemRootHex(block: BlockInputSyncCacheItem): RootHex {
  return isPendingBlockInput(block) ? block.blockInput.rootHex : block.rootHex;
}
