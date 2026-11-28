import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {CheckpointStateCache as CheckpointStateCacheBinding} from "@lodestar/native/regen";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {IBeaconStateView, IBeaconStateViewNative, NativeBeaconStateView} from "@lodestar/state-transition";
import {Epoch, RootHex, phase0} from "@lodestar/types";
import {ErrorAborted, LodestarError, Logger, fromHex, sleep, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {IClock} from "../../util/clock.js";
import {MapTracker} from "./mapMetrics.js";
import {NativeBlockStateCache} from "./nativeBlockStateCache.js";
import {getBinding, nativeErrorCode} from "./nativeStateCacheUtils.js";
import {
  DEFAULT_MAX_CP_STATE_EPOCHS_IN_MEMORY,
  PROCESS_CHECKPOINT_STATES_BPS,
  PersistentCheckpointStateCacheOpts,
  toCheckpointKey,
} from "./persistentCheckpointsCache.js";
import {CacheItemType, CheckpointHex, CheckpointStateCache} from "./types.js";

type NativeCheckpointStateCacheModules = {
  config: BeaconConfig;
  blockStateCache: NativeBlockStateCache;
  dataDir: string;
  logger: Logger;
  signal: AbortSignal;
  clock?: IClock | null;
  metrics?: Metrics | null;
};

/**
 * Memoizes JS state wrappers and their per-view caches for a subset of native-resident checkpoints.
 * Native controls membership and persistence: add() writes native first, and JS misses read native.
 * The checkpoint index includes native entries without JS wrappers, so latest lookups also find them.
 * JS must never retain a wrapper for a checkpoint that is no longer resident in native memory.
 * Native mutations, including regen through the shared binding, must call syncCache() before returning
 * or yielding so persisted/removed entries lose their JS wrappers without releasing callers' views.
 * Abort cancels maintenance, but cache reads remain available to in-flight consumers until GC.
 */
export class NativeCheckpointStateCache implements CheckpointStateCache {
  readonly binding: CheckpointStateCacheBinding;
  private readonly config: BeaconConfig;
  private readonly logger: Logger;
  private readonly signal: AbortSignal;
  private readonly clock: IClock | null | undefined;
  private readonly maxEpochsInMemory: number;
  private readonly cache = new MapTracker<string, IBeaconStateView>();
  private checkpoints = new Map<string, CheckpointHex & {inMemory: boolean}>();
  private cacheHits = 0;
  private precomputedCheckpoint: string | null = null;
  private precomputedHits = 0;
  private closed = false;

  constructor(
    {config, blockStateCache, dataDir, logger, signal, clock, metrics}: NativeCheckpointStateCacheModules,
    opts: PersistentCheckpointStateCacheOpts
  ) {
    this.config = config;
    this.logger = logger;
    this.signal = signal;
    this.clock = clock;
    this.maxEpochsInMemory = opts.maxCPStateEpochsInMemory ?? DEFAULT_MAX_CP_STATE_EPOCHS_IN_MEMORY;
    this.assertOpen();
    blockStateCache.assertOpen();
    this.binding = new CheckpointStateCacheBinding(
      blockStateCache.binding,
      dataDir,
      this.maxEpochsInMemory,
      opts.maxCPStateEpochsOnDisk === Infinity ? undefined : opts.maxCPStateEpochsOnDisk
    );
    if (metrics) {
      metrics.cpStateCache.size.addCollect(() => {
        if (this.closed || this.signal.aborted) return;
        const stats = this.binding.stats();
        metrics.cpStateCache.lookups.set(stats.lookups + this.cacheHits);
        metrics.cpStateCache.hits.set(stats.hits + this.cacheHits);
        metrics.cpStateCache.adds.set(stats.adds);
        metrics.cpStateCache.size.set({type: CacheItemType.inMemory}, stats.inMemory);
        metrics.cpStateCache.size.set({type: CacheItemType.persisted}, stats.persisted);
        metrics.cpStateCache.statePruneFromMemoryCount.set(stats.pruned);
      });
      metrics.cpStateCache.reads.addGetValuesFn(() =>
        this.closed || this.signal.aborted ? [] : this.dumpSummary().map((item) => item.reads)
      );
      metrics.cpStateCache.secondsSinceLastRead.addGetValuesFn(() =>
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
    this.checkpoints.clear();
    this.binding.release();
  }

  assertOpen(): void {
    if (this.closed) throw new LodestarError({code: "NATIVE_REGEN_CLOSED"});
  }

  async init(): Promise<void> {
    this.assertOpen();
    this.binding.initStore();
  }

  get(cpOrKey: CheckpointHex | string): IBeaconStateView | null {
    this.assertOpen();
    let cp: CheckpointHex;
    if (typeof cpOrKey === "string") {
      const [rootHex, epoch] = cpOrKey.split("_");
      cp = {rootHex, epoch: Number(epoch)};
    } else {
      cp = cpOrKey;
    }
    const cached = this.getCachedState(cp);
    if (cached) return cached;
    const binding = this.binding.get(cp.epoch, fromHex(cp.rootHex));
    if (!binding) return null;
    const state = new NativeBeaconStateView(this.config, binding as IBeaconStateViewNative);
    this.cache.set(toCheckpointKey(cp), state);
    return state;
  }

  /** Keeps the JS view; the binding borrows it and retains a native reference on insertion/replacement. */
  add(cp: phase0.Checkpoint, state: IBeaconStateView): void {
    this.assertOpen();
    this.binding.add(cp.epoch, cp.root, getBinding(state));
    this.cache.set(toCheckpointKey({epoch: cp.epoch, rootHex: toRootHex(cp.root)}), state);
    this.syncCache();
    try {
      this.binding.drainPendingDeletes();
    } catch (error) {
      if (!this.closed && !this.signal.aborted)
        this.logger.debug("Native checkpoint deletion failed", {epoch: cp.epoch}, error as Error);
    }
  }

  getLatest(root: RootHex, epoch: Epoch): IBeaconStateView | null {
    this.assertOpen();
    let latest: CheckpointHex | undefined;
    for (const cp of this.checkpoints.values()) {
      if (cp.inMemory && cp.rootHex === root && cp.epoch <= epoch && (!latest || cp.epoch > latest.epoch)) {
        latest = cp;
      }
    }
    return latest ? this.get(latest) : null;
  }

  async getOrReload(cp: CheckpointHex): Promise<IBeaconStateView | null> {
    this.assertOpen();
    const cached = this.getCachedState(cp);
    if (cached) return cached;
    try {
      const binding = this.binding.getOrReload(cp.epoch, fromHex(cp.rootHex));
      if (!binding) return null;
      const state = new NativeBeaconStateView(this.config, binding as IBeaconStateViewNative);
      this.cache.set(toCheckpointKey(cp), state);
      return state;
    } catch (error) {
      if (
        !["InvalidStateBytes", "StateCacheInitializationFailed", "InvalidCheckpoint", "StreamTooLong"].includes(
          nativeErrorCode(error) ?? ""
        )
      )
        throw error;
      this.logger.debug("Unusable native checkpoint state", {epoch: cp.epoch, root: cp.rootHex}, error as Error);
      return null;
    } finally {
      this.syncCache();
    }
  }

  async getOrReloadLatest(root: RootHex, epoch: Epoch): Promise<IBeaconStateView | null> {
    this.assertOpen();
    const checkpoints = Array.from(this.checkpoints.values())
      .filter((cp) => cp.rootHex === root && cp.epoch <= epoch)
      .sort((a, b) => b.epoch - a.epoch);
    for (const cp of checkpoints) {
      try {
        const state = await this.getOrReload(cp);
        if (state) return state;
      } catch (error) {
        if (["OutOfMemory", "PoolExhausted", "Canceled"].includes(nativeErrorCode(error) ?? "")) throw error;
        if (this.closed || this.signal.aborted) throw error;
      }
    }
    return null;
  }

  async getStateOrBytes(cp: CheckpointHex): Promise<IBeaconStateView | Uint8Array | null> {
    return this.get(cp) ?? this.binding.getBytes(cp.epoch, fromHex(cp.rootHex)) ?? null;
  }

  updatePreComputedCheckpoint(root: RootHex, epoch: Epoch): number | null {
    this.assertOpen();
    const nativeHits = this.binding.updatePreComputedCheckpoint(epoch, fromHex(root));
    const hits = nativeHits === undefined ? null : nativeHits + this.precomputedHits;
    this.precomputedCheckpoint = toCheckpointKey({epoch, rootHex: root});
    this.precomputedHits = 0;
    return hits;
  }

  onCheckpoint(finalized: Epoch, justified: Epoch): void {
    this.assertOpen();
    this.binding.onCheckpoint(finalized, justified);
  }

  /** Borrows state across the slot delay and synchronous native call; callers must not release it meanwhile. */
  async processState(root: RootHex, state: IBeaconStateView): Promise<number> {
    this.assertOpen();
    if (this.signal.aborted) throw new ErrorAborted();
    const finalizedEpoch = state.finalizedCheckpoint.epoch;
    const epochs = new Set<Epoch>();
    for (const cp of this.checkpoints.values()) {
      if (cp.epoch >= finalizedEpoch) epochs.add(cp.epoch);
    }
    if (epochs.size > this.maxEpochsInMemory) {
      const slot = state.slot;
      const processTime = this.config.getSlotComponentDurationMs(
        this.config.getForkName(slot),
        PROCESS_CHECKPOINT_STATES_BPS
      );
      const delay = processTime - (this.clock?.msFromSlot(slot) ?? processTime);
      if (delay > 0) {
        // Match TS persistence timing, leaving early-slot block import and attestations unblocked.
        await sleep(delay, this.signal);
      }
    }
    this.assertOpen();
    if (this.signal.aborted) throw new ErrorAborted();
    try {
      return this.binding.processState(fromHex(root), getBinding(state));
    } finally {
      this.syncCache();
    }
  }

  async clear(): Promise<void> {
    this.assertOpen();
    try {
      this.binding.clear();
    } finally {
      this.syncCache();
    }
  }

  /** Reconcile after native mutations; persisted-only checkpoints must not retain JS views. */
  syncCache(): void {
    this.assertOpen();
    this.checkpoints = new Map(
      this.binding.getCheckpoints().map(({epoch, root, inMemory}) => {
        const cp = {epoch, rootHex: toRootHex(root), inMemory};
        return [toCheckpointKey(cp), cp];
      })
    );
    // Native may already have pruned checkpoints or persisted their states and released its references.
    // Follow those removals here so this JS cache does not keep the states alive through their wrappers.
    for (const key of this.cache.keys()) {
      if (!this.checkpoints.get(key)?.inMemory) this.cache.delete(key);
    }
  }

  private getCachedState(cp: CheckpointHex): IBeaconStateView | null {
    const key = toCheckpointKey(cp);
    const state = this.cache.get(key);
    if (state) {
      this.cacheHits++;
      if (key === this.precomputedCheckpoint) this.precomputedHits++;
    }
    return state ?? null;
  }

  dumpSummary(): routes.lodestar.StateCacheItem[] {
    this.assertOpen();
    return this.binding.dumpSummary().map((item) => {
      const root = toRootHex(item.root);
      const key = toCheckpointKey({epoch: item.slot / SLOTS_PER_EPOCH, rootHex: root});
      return {
        ...item,
        root,
        reads: item.reads + (this.cache.readCount.get(key) ?? 0),
        lastRead: Math.max(item.lastRead, this.cache.lastRead.get(key) ?? 0),
      };
    });
  }

  getStates(): IterableIterator<IBeaconStateView> {
    const states: IBeaconStateView[] = [];
    this.assertOpen();
    for (const cp of this.checkpoints.values()) {
      if (!cp.inMemory) continue;
      const state = this.get(cp);
      if (state) states.push(state);
    }
    return states.values();
  }
}
