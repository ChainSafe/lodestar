import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {RootHex, Slot, phase0} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {BlockInput, BlockInputType, NullBlockInput} from "../chain/blocks/types.js";
import {IBeaconChain} from "../chain/index.js";
import {IBeaconDb} from "../db/index.js";
import {Metrics} from "../metrics/index.js";
import {INetwork} from "../network/index.js";
import {SyncChainDebugState} from "./range/chain.js";
export type {SyncChainDebugState};

export type SyncingStatus = routes.node.SyncingStatus;

export interface IBeaconSync {
  state: SyncState;
  close(): void;
  getSyncStatus(): SyncingStatus;
  isSynced(): boolean;
  isSyncing(): boolean;
  getSyncChainsDebugState(): SyncChainDebugState[];
}

export enum SyncState {
  /** No useful peers are connected */
  Stalled = "Stalled",
  /** The node is performing a long-range sync over a finalized chain */
  SyncingFinalized = "SyncingFinalized",
  /** The node is performing a long-range sync over head chains */
  SyncingHead = "SyncingHead",
  /** The node is up to date with all known peers */
  Synced = "Synced",
}

/** Map a SyncState to an integer for rendering in Grafana */
export const syncStateMetric: {[K in SyncState]: number} = {
  [SyncState.Stalled]: 0,
  [SyncState.SyncingFinalized]: 1,
  [SyncState.SyncingHead]: 2,
  [SyncState.Synced]: 3,
};

export type SlotRange = {
  start: Slot;
  end: Slot;
};

export interface SyncModules {
  config: BeaconConfig;
  network: INetwork;
  db: IBeaconDb;
  metrics: Metrics | null;
  logger: Logger;
  chain: IBeaconChain;
  wsCheckpoint?: phase0.Checkpoint;
}

export type UnknownAndAncestorBlocks = {
  unknowns: UnknownBlock[];
  ancestors: DownloadedBlock[];
};

/**
 * onUnknownBlock: store 1 record with undefined parentBlockRootHex & blockInput, blockRootHex as key, status pending
 * onUnknownBlockParent:
 *   - store 1 record with known parentBlockRootHex & blockInput, blockRootHex as key, status downloaded
 *   - store 1 record with undefined parentBlockRootHex & blockInput, parentBlockRootHex as key, status pending
 */
export type PendingBlock = UnknownBlock | DownloadedBlock;

type PendingBlockCommon = {
  blockRootHex: RootHex;
  peerIdStrs: Set<string>;
  downloadAttempts: number;
};

export type UnknownBlock = PendingBlockCommon & {
  status: PendingBlockStatus.pending | PendingBlockStatus.fetching;
  parentBlockRootHex: null;
} & (
    | {unknownBlockType: PendingBlockType.UNKNOWN_BLOCK; blockInput: null}
    | {unknownBlockType: PendingBlockType.UNKNOWN_BLOBS; blockInput: BlockInput & {type: BlockInputType.dataPromise}}
    | {unknownBlockType: PendingBlockType.UNKNOWN_BLOCKINPUT; blockInput: NullBlockInput}
  );

/**
 * either the blobs are unknown or in future some blobs and even the block is unknown
 */

export type DownloadedBlock = PendingBlockCommon & {
  status: PendingBlockStatus.downloaded | PendingBlockStatus.processing;
  parentBlockRootHex: RootHex;
  blockInput: BlockInput;
};

export enum PendingBlockStatus {
  pending = "pending",
  fetching = "fetching",
  downloaded = "downloaded",
  processing = "processing",
}

export enum PendingBlockType {
  /**
   * We got a block root (from a gossip attestation, for exxample) but we don't have the block in forkchoice.
   */
  UNKNOWN_BLOCK = "unknown_block",
  /**
   * During gossip time, we may get a block but the parent root is unknown (not in forkchoice).
   */
  UNKNOWN_PARENT = "unknown_parent",

  UNKNOWN_BLOCKINPUT = "unknown_blockinput",
  UNKNOWN_BLOBS = "unknown_blobs",
}
