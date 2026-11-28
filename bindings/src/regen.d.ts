import type {ForkChoice} from "./fork-choice.js";
import type {BeaconStateView} from "./index.js";

/** Owned full SignedBeaconBlock bytes keyed by the unsigned beacon block root. */
export declare class SeenBlock {
  constructor(maxBlocks: number, maxBytes: number, maxBlockBytes: number);
  readonly size: number;
  readonly byteSize: number;
  /** Copies bytes. Duplicate roots preserve the resident bytes and FIFO position. */
  add(root: Uint8Array, bytes: Uint8Array): boolean;
  /** Returns an owned copy, or undefined on a cache miss. */
  get(root: Uint8Array): Uint8Array | undefined;
  has(root: Uint8Array): boolean;
  remove(root: Uint8Array): boolean;
  clear(): void;
  release(): void;
}

/**
 * Serialized access only. Returned views own state, config, and pool references,
 * independently of the cache. Cache misses return undefined.
 */
export declare class BlockStateCache {
  /** Borrows anchor for this call; the cache retains its config and pool. */
  constructor(anchor: BeaconStateView, maxStates: number);
  readonly size: number;
  /** Borrows state for this call and retains a native reference only on insertion. Caller ownership is unchanged. */
  add(state: BeaconStateView): void;
  /** Borrows state for this call and retains a native reference only on insertion. */
  setHeadState(state?: BeaconStateView): void;
  get(root: Uint8Array): BeaconStateView | undefined;
  getSeedState(): BeaconStateView;
  clear(): void;
  onCheckpoint(headRoot: Uint8Array): void;
  /** Resident roots in insertion order; the first root identifies the reload seed. */
  getStateRoots(): Uint8Array[];
  stats(): {lookups: number; hits: number; adds: number};
  dumpSummary(): StateCacheItem[];
  release(): void;
}

/**
 * Retains blockCache for reload seeds and state resources. Returned views own state, config,
 * and pool references independently of the cache. Cache misses return undefined.
 */
export declare class CheckpointStateCache {
  constructor(blockCache: BlockStateCache, dataDir: string, maxEpochs: number, diskEpochs?: number);
  initStore(): void;
  /** Borrows state for this call; retains a native reference on insertion/replacement. Caller ownership is unchanged. */
  add(epoch: number, root: Uint8Array, state: BeaconStateView): void;
  get(epoch: number, root: Uint8Array): BeaconStateView | undefined;
  getLatest(root: Uint8Array, epoch?: number): BeaconStateView | undefined;
  getOrReload(epoch: number, root: Uint8Array): BeaconStateView | undefined;
  getOrReloadLatest(root: Uint8Array, epoch?: number): BeaconStateView | undefined;
  /** Reads persisted bytes; throws CheckpointStillResident for an in-memory entry. */
  getBytes(epoch: number, root: Uint8Array): Uint8Array | undefined;
  onCheckpoint(finalizedEpoch: number, justifiedEpoch: number): void;
  updatePreComputedCheckpoint(epoch: number, root: Uint8Array): number | undefined;
  /** Borrows state for this synchronous call; the native operation holds a reference during pruning. */
  processState(root: Uint8Array, state: BeaconStateView): number;
  stats(): {
    lookups: number;
    hits: number;
    adds: number;
    persists: number;
    reloads: number;
    pruned: number;
    inMemory: number;
    persisted: number;
  };
  drainPendingDeletes(): void;
  getCheckpoints(): {epoch: number; root: Uint8Array; inMemory: boolean}[];
  clear(): void;
  dumpSummary(): StateCacheItem[];
  release(): void;
}

export type StateCacheItem = {
  slot: number;
  root: Uint8Array;
  reads: number;
  lastRead: number;
  checkpointState: boolean;
};

/** Replay computed a state root different from the imported fork-choice summary. */
export interface InvalidStateRootError extends Error {
  code: "InvalidStateRoot";
  slot: number;
  expected: Uint8Array;
  actual: Uint8Array;
}

/**
 * Synchronous native calls. The host owns scheduling and checkpoint event publication.
 * Retains the native caches, SeenBlock, and fork-choice store independently of their JS wrappers.
 * checkpointCache must retain blockCache; fork choice must use matching config and genesis validators root.
 * Returned views own state, config, and pool references independently of any native cache reference.
 * Replay root mismatches throw InvalidStateRootError with slot and owned root bytes.
 */
export declare class StateRegenerator {
  constructor(
    blockCache: BlockStateCache,
    checkpointCache: CheckpointStateCache,
    seen: SeenBlock,
    forkChoice: ForkChoice
  );
  getState(root: Uint8Array, allowDiskReload: boolean): BeaconStateView;
  getPreState(parentRoot: Uint8Array, slot: number, dontTransferCache: boolean): BeaconStateView;
  getBlockSlotState(
    root: Uint8Array,
    slot: number,
    dontTransferCache: boolean,
    allowDiskReload: boolean
  ): BeaconStateView;
  release(): void;
}
