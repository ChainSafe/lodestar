import {IBlockInput} from "@lodestar/beacon-node/src/chain/blocks/blockInput/index.js";
import {RootHex} from "@lodestar/types";

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
  return isPendingBlockInput(block) ? block.blockInput.blockRootHex : block.rootHex;
}
