import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {BlockStateCache as BlockStateCacheBinding} from "@lodestar/native/regen";
import {IBeaconStateView, IBeaconStateViewNative, NativeBeaconStateView} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {LodestarError, fromHex, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {DEFAULT_MAX_BLOCK_STATES, FIFOBlockStateCacheOpts} from "./fifoBlockStateCache.js";
import {MapTracker} from "./mapMetrics.js";
import {getBinding} from "./nativeStateCacheUtils.js";
import {BlockStateCache} from "./types.js";

type NativeBlockStateCacheModules = {
  config: BeaconConfig;
  anchorState: NativeBeaconStateView;
  signal: AbortSignal;
  metrics?: Metrics | null;
};

/**
 * Memoizes JS state wrappers and their per-view caches for a subset of native-resident block states.
 * Native controls membership and eviction: add()/setHeadState() write native first, and JS misses read native.
 * The root index includes native entries without JS wrappers, preserving native seed and iteration order.
 * JS must never retain a wrapper for a state that is no longer resident in native memory.
 * Callers mutating native outside this adapter, including replay, must call syncCache() before returning
 * or yielding so evicted entries lose their JS wrappers without releasing callers' views.
 * Abort stops regen work, but cache reads remain available to in-flight consumers until GC.
 */
export class NativeBlockStateCache implements BlockStateCache {
  readonly binding: BlockStateCacheBinding;
  private readonly config: BeaconConfig;
  private readonly signal: AbortSignal;
  private readonly metrics: Metrics["stateCache"] | undefined;
  private readonly cache = new MapTracker<RootHex, IBeaconStateView>();
  private stateRoots: RootHex[] = [];
  private cacheHits = 0;
  private closed = false;

  constructor({config, anchorState, signal, metrics}: NativeBlockStateCacheModules, opts: FIFOBlockStateCacheOpts) {
    this.config = config;
    this.signal = signal;
    this.metrics = metrics?.stateCache;
    this.assertOpen();
    this.binding = new BlockStateCacheBinding(getBinding(anchorState), opts.maxBlockStates ?? DEFAULT_MAX_BLOCK_STATES);
    if (metrics) {
      metrics.stateCache.size.addCollect(() => {
        if (this.closed || this.signal.aborted) return;
        const stats = this.binding.stats();
        metrics.stateCache.size.set(this.binding.size);
        metrics.stateCache.lookups.set(stats.lookups + this.cacheHits);
        metrics.stateCache.hits.set(stats.hits + this.cacheHits);
        metrics.stateCache.adds.set(stats.adds);
      });
      metrics.stateCache.reads.addGetValuesFn(() =>
        this.closed || this.signal.aborted ? [] : this.dumpSummary().map((item) => item.reads)
      );
      metrics.stateCache.secondsSinceLastRead.addGetValuesFn(() =>
        this.closed || this.signal.aborted
          ? []
          : this.dumpSummary()
              .filter((item) => item.lastRead !== 0)
              .map((item) => (Date.now() - item.lastRead) / 1000)
      );
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cache.clear();
    this.stateRoots = [];
    this.binding.release();
  }

  assertOpen(): void {
    if (this.closed) throw new LodestarError({code: "NATIVE_REGEN_CLOSED"});
  }

  get(root: RootHex): IBeaconStateView | null {
    this.assertOpen();
    const cached = this.cache.get(root);
    if (cached) {
      this.cacheHits++;
      this.metrics?.stateClonedCount.observe(cached.clonedCount);
      return cached;
    }
    const binding = this.binding.get(fromHex(root));
    if (!binding) return null;
    const state = new NativeBeaconStateView(this.config, binding as IBeaconStateViewNative);
    this.cache.set(root, state);
    return state;
  }

  /** Keeps the JS view; the binding borrows it and retains a native reference on insertion. */
  add(state: IBeaconStateView): void {
    this.assertOpen();
    const root = toRootHex(state.hashTreeRoot());
    const resident = this.stateRoots.includes(root);
    this.binding.add(getBinding(state));
    if (!resident) this.cache.set(root, state);
    this.syncCache();
  }

  /** Keeps the JS view on insertion; duplicate roots preserve the resident view. */
  setHeadState(state: IBeaconStateView | null): void {
    this.assertOpen();
    if (!state) return;
    const root = toRootHex(state.hashTreeRoot());
    const resident = this.stateRoots.includes(root);
    this.binding.setHeadState(getBinding(state));
    if (!resident) this.cache.set(root, state);
    this.syncCache();
  }

  getSeedState(): IBeaconStateView {
    this.assertOpen();
    const root = this.stateRoots[0];
    if (root) {
      const state = this.get(root);
      if (state) return state;
    }
    return new NativeBeaconStateView(this.config, this.binding.getSeedState() as IBeaconStateViewNative);
  }

  clear(): void {
    this.assertOpen();
    this.binding.clear();
    this.cache.clear();
    this.stateRoots = [];
  }

  get size(): number {
    this.assertOpen();
    return this.binding.size;
  }

  onCheckpoint(root: RootHex): void {
    this.assertOpen();
    this.binding.onCheckpoint(fromHex(root));
    this.syncCache();
  }

  /**
   * Reconcile after native mutations, including replay that bypasses this adapter.
   * Records the returned JS view if native admitted it, without acquiring another native reference.
   */
  syncCache(state?: IBeaconStateView): void {
    this.assertOpen();
    this.stateRoots = this.binding.getStateRoots().map(toRootHex);
    const resident = new Set(this.stateRoots);
    // Native may already have pruned states to enforce maxBlockStates. Follow that pruning here
    // so this JS cache does not keep evicted states alive through their wrappers.
    for (const root of this.cache.keys()) {
      if (!resident.has(root)) this.cache.delete(root);
    }
    if (state) {
      const root = toRootHex(state.hashTreeRoot());
      if (resident.has(root) && !this.cache.has(root)) this.cache.set(root, state);
    }
  }

  dumpSummary(): routes.lodestar.StateCacheItem[] {
    this.assertOpen();
    return this.binding.dumpSummary().map((item) => {
      const root = toRootHex(item.root);
      return {
        ...item,
        root,
        reads: item.reads + (this.cache.readCount.get(root) ?? 0),
        lastRead: Math.max(item.lastRead, this.cache.lastRead.get(root) ?? 0),
      };
    });
  }

  getStates(): IterableIterator<IBeaconStateView> {
    const states: IBeaconStateView[] = [];
    this.assertOpen();
    for (const root of this.stateRoots) {
      const state = this.get(root);
      if (state) states.push(state);
    }
    return states.values();
  }
}
