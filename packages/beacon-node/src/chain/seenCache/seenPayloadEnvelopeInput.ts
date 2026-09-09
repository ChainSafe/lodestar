import {ChainForkConfig} from "@lodestar/config";
import {CheckpointWithHex, IForkChoice, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkPostGloas, SLOTS_PER_EPOCH, isForkPostGloas} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock} from "@lodestar/types";
import {Logger, fromHex} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {MAX_LOOK_AHEAD_EPOCHS} from "../../sync/constants.js";
import {IClock} from "../../util/clock.js";
import {CustodyConfig} from "../../util/dataColumns.js";
import {SerializedCache} from "../../util/serializedCache.js";
import {isDaOutOfRange} from "../blocks/blockInput/index.js";
import {
  CreateFromBidProps,
  CreateFromBlockProps,
  PayloadEnvelopeInput,
  PayloadEnvelopeInputPruneReason,
  PayloadEnvelopeInputSource,
} from "../blocks/payloadEnvelopeInput/index.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";
import {SeenBlockInput} from "./seenGossipBlockInput.js";

export type {PayloadEnvelopeInputState} from "../blocks/payloadEnvelopeInput/index.js";
export {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";

// Bound this cache by this max size, this is the same to SeenBlockInput
const MAX_PAYLOAD_ENVELOPE_INPUT_CACHE_SIZE = (MAX_LOOK_AHEAD_EPOCHS + 1) * SLOTS_PER_EPOCH;

export type SeenPayloadEnvelopeInputModules = {
  config: ChainForkConfig;
  clock: IClock;
  forkChoice: IForkChoice;
  chainEvents: ChainEventEmitter;
  signal: AbortSignal;
  serializedCache: SerializedCache;
  db: IBeaconDb;
  seenBlockInputCache: SeenBlockInput;
  custodyConfig: CustodyConfig;
  metrics: Metrics | null;
  logger?: Logger;
};

/**
 * Cache for tracking PayloadEnvelopeInput instances, keyed by beacon block root.
 *
 * Created whenever we have a block because it needs block bid.
 * Steady state (linear chain, healthy progression): the cache holds ~2 entries — the head
 * (parent for next-slot production) and its parent (proposer-boost-reorg fallback). It can
 * transiently hold more during forks, range-sync bursts, or when `prepareNextSlot` skips
 * ticks; subsequent ticks settle it back.
 */
export class SeenPayloadEnvelopeInput {
  private readonly config: ChainForkConfig;
  private readonly clock: IClock;
  private readonly forkChoice: IForkChoice;
  private readonly chainEvents: ChainEventEmitter;
  private readonly signal: AbortSignal;
  private readonly serializedCache: SerializedCache;
  private readonly db: IBeaconDb;
  private readonly seenBlockInputCache: SeenBlockInput;
  private readonly custodyConfig: CustodyConfig;
  private readonly metrics: Metrics | null;
  private readonly logger?: Logger;
  private payloadInputs = new Map<RootHex, PayloadEnvelopeInput>();
  // Dedup concurrent DB reloads of the same root so callers share one reconstructed object.
  private readonly reloading = new Map<RootHex, Promise<PayloadEnvelopeInput | undefined>>();

  constructor({
    config,
    clock,
    forkChoice,
    chainEvents,
    signal,
    serializedCache,
    db,
    seenBlockInputCache,
    custodyConfig,
    metrics,
    logger,
  }: SeenPayloadEnvelopeInputModules) {
    this.config = config;
    this.clock = clock;
    this.forkChoice = forkChoice;
    this.chainEvents = chainEvents;
    this.signal = signal;
    this.serializedCache = serializedCache;
    this.db = db;
    this.seenBlockInputCache = seenBlockInputCache;
    this.custodyConfig = custodyConfig;
    this.metrics = metrics;
    this.logger = logger;

    if (metrics) {
      metrics.seenCache.payloadEnvelopeInput.count.addCollect(() => {
        metrics.seenCache.payloadEnvelopeInput.count.set(this.payloadInputs.size);
        metrics.seenCache.payloadEnvelopeInput.serializedObjectRefs.set(
          Array.from(this.payloadInputs.values()).reduce(
            (count, payloadInput) => count + payloadInput.getSerializedCacheKeys().length,
            0
          )
        );
      });
    }

    this.chainEvents.on(ChainEvent.forkChoiceFinalized, this.pruneFinalized);
    this.signal.addEventListener("abort", () => {
      this.chainEvents.off(ChainEvent.forkChoiceFinalized, this.pruneFinalized);
    });
  }

  private pruneFinalized = (checkpoint: CheckpointWithHex): void => {
    const finalizedSlot = computeStartSlotAtEpoch(checkpoint.epoch);
    let deletedCount = 0;
    for (const [, input] of this.payloadInputs) {
      if (input.slot < finalizedSlot) {
        this.evictPayloadInput(input, "finalized");
        deletedCount++;
      }
    }

    this.logger?.debug("SeenPayloadEnvelopeInput.pruneFinalized deleted entries", {
      finalizedSlot,
      finalizedRoot: checkpoint.rootHex,
      deletedCount,
    });
  };

  add(props: Omit<CreateFromBlockProps, "daOutOfRange">): PayloadEnvelopeInput {
    const existing = this.payloadInputs.get(props.blockRootHex);
    if (existing !== undefined) {
      this.logger?.verbose("SeenPayloadEnvelopeInput.add reused existing entry", {
        slot: existing.slot,
        root: props.blockRootHex,
      });
      return existing;
    }
    const daOutOfRange = isDaOutOfRange(this.config, props.forkName, props.block.message.slot, this.clock.currentEpoch);
    const input = PayloadEnvelopeInput.createFromBlock({...props, daOutOfRange});
    this.payloadInputs.set(props.blockRootHex, input);
    this.metrics?.seenCache.payloadEnvelopeInput.created.inc({source: props.source});
    this.logger?.verbose("SeenPayloadEnvelopeInput.add created new entry", {
      slot: input.slot,
      root: props.blockRootHex,
      daOutOfRange,
    });
    this.pruneToMaxSize();
    return input;
  }

  /**
   * Used at chain initialization to seed the anchor block's PayloadEnvelopeInput from
   * `state.latestExecutionPayloadBid`.
   */
  addFromBid(props: Omit<CreateFromBidProps, "daOutOfRange">): PayloadEnvelopeInput {
    const existing = this.payloadInputs.get(props.blockRootHex);
    if (existing !== undefined) {
      return existing;
    }
    const daOutOfRange = isDaOutOfRange(this.config, props.forkName, props.slot, this.clock.currentEpoch);
    const input = PayloadEnvelopeInput.createFromBid({...props, daOutOfRange});
    this.payloadInputs.set(props.blockRootHex, input);
    this.metrics?.seenCache.payloadEnvelopeInput.created.inc({source: props.source});
    this.logger?.verbose("SeenPayloadEnvelopeInput.addFromBid created new entry", {
      slot: input.slot,
      root: props.blockRootHex,
      daOutOfRange,
    });
    this.pruneToMaxSize();
    return input;
  }

  get(blockRootHex: RootHex): PayloadEnvelopeInput | undefined {
    return this.payloadInputs.get(blockRootHex);
  }

  /**
   * Like `get()`, but on a cache miss reconstruct the shell (bid + versionedHashes) from the block
   * in `seenBlockInputCache` or the hot DB.
   * This api is meant for BlockInputSync when a late/weird payloads for old blocks
   *
   * NOTE: the reconstructed entry is always EMPTY even when the block is actually FULL (its
   * payload envelope + columns persisted in the DB). The consumer should consult fork choice if it needs to.
   */
  async getOrReload(blockRootHex: RootHex): Promise<PayloadEnvelopeInput | undefined> {
    const existing = this.payloadInputs.get(blockRootHex);
    if (existing !== undefined) {
      return existing;
    }

    // Without this dedup, two concurrent misses each db.block.get + createFromBlock a DIFFERENT shell
    // for the same root; processPayloadEnvelopeJob's WeakMap (keyed by object) can't dedup the import.
    const inflight = this.reloading.get(blockRootHex);
    if (inflight !== undefined) {
      return inflight;
    }
    const promise = this.reloadFromDb(blockRootHex);
    this.reloading.set(blockRootHex, promise);
    try {
      return await promise;
    } finally {
      this.reloading.delete(blockRootHex);
    }
  }

  private async reloadFromDb(blockRootHex: RootHex): Promise<PayloadEnvelopeInput | undefined> {
    // Only recover unfinalized, fork-choice-known blocks. Do not read the finalized archive. The gate
    // also filters out un-imported blocks that may sit in seenBlockInputCache before validation.
    if (!this.forkChoice.hasBlockHex(blockRootHex)) {
      return undefined;
    }

    // In-memory first: persistBlockInput writes db.block THEN prunes seenBlockInputCache, so a
    // just-imported block whose async write (unfinalizedBlockWrites) has not flushed yet is still here;
    // older blocks (already pruned from the cache) fall through to the hot db.
    const cachedBlockInput = this.seenBlockInputCache.get(blockRootHex);
    const block = cachedBlockInput?.hasBlock()
      ? cachedBlockInput.getBlock()
      : await this.db.block.get(fromHex(blockRootHex));
    if (block == null) {
      return undefined;
    }

    const forkName = this.config.getForkName(block.message.slot);
    if (!isForkPostGloas(forkName)) {
      return undefined;
    }

    const daOutOfRange = isDaOutOfRange(this.config, forkName, block.message.slot, this.clock.currentEpoch);
    const input = PayloadEnvelopeInput.createFromBlock({
      blockRootHex,
      block: block as SignedBeaconBlock<ForkPostGloas>,
      forkName,
      sampledColumns: this.custodyConfig.sampledColumns,
      custodyColumns: this.custodyConfig.custodyColumns,
      seenTimestampSec: Date.now() / 1000,
      source: PayloadEnvelopeInputSource.reload,
      daOutOfRange,
    });
    this.payloadInputs.set(blockRootHex, input);
    this.metrics?.seenCache.payloadEnvelopeInput.created.inc({source: PayloadEnvelopeInputSource.reload});
    this.logger?.verbose("SeenPayloadEnvelopeInput.getOrReload reconstructed entry from db", {
      slot: input.slot,
      root: blockRootHex,
    });
    // Set above (entry is at the back of the insertion order), so the cap never evicts what we just reloaded.
    this.pruneToMaxSize();
    return input;
  }

  hasPayload(blockRootHex: RootHex): boolean {
    return this.payloadInputs.get(blockRootHex)?.hasPayloadEnvelope() ?? false;
  }

  size(): number {
    return this.payloadInputs.size;
  }

  prune(blockRootHex: RootHex): void {
    const input = this.payloadInputs.get(blockRootHex);
    if (input) {
      this.evictPayloadInput(input, "prune");
    }
  }

  pruneBelowParent(parentBlock: ProtoBlock): void {
    for (const block of this.forkChoice.getAllAncestorBlocks(parentBlock.blockRoot, parentBlock.payloadStatus)) {
      // Only evict once the payload is FULL (revealed/imported) — on an EMPTY/PENDING branch we may
      // still need to download the FULL envelope (see #9475), and evicting would make payload-by-root
      // sync throw "Missing PayloadEnvelopeInput for known block".
      if (block.slot < parentBlock.slot && block.payloadStatus === PayloadStatus.FULL) {
        const input = this.payloadInputs.get(block.blockRoot);
        // ...and don't evict while columns are still being gathered: writeDataColumnsToDb awaits the
        // same hasComputedAllData() before persisting. Such entries are pruned by a later call.
        if (input?.hasComputedAllData()) {
          this.evictPayloadInput(input, "belowParent");
        }
      }
    }
  }

  /**
   * Bound this cache to have at most MAX_PAYLOAD_ENVELOPE_INPUT_CACHE_SIZE items.
   * Evicts by insertion order so a just-reloaded old-slot entry is not evicted right after.
   * On unstable network, we may need to query an evicted item, UnknownBlockInput will recover
   * it from db via getOrReload() api. Runs after every single insert, so it evicts ~1 per call.
   */
  private pruneToMaxSize(): void {
    let evicted = 0;
    for (const input of this.payloadInputs.values()) {
      if (this.payloadInputs.size <= MAX_PAYLOAD_ENVELOPE_INPUT_CACHE_SIZE) {
        break;
      }
      this.evictPayloadInput(input, "cap");
      evicted++;
    }
    if (evicted > 0) {
      this.logger?.debug("SeenPayloadEnvelopeInput.pruneToMaxSize evicted", {
        evicted,
        size: this.payloadInputs.size,
        max: MAX_PAYLOAD_ENVELOPE_INPUT_CACHE_SIZE,
      });
    }
  }

  private evictPayloadInput(payloadInput: PayloadEnvelopeInput, reason: PayloadEnvelopeInputPruneReason): void {
    this.metrics?.seenCache.payloadEnvelopeInput.pruned.inc({reason});
    this.logger?.debug("SeenPayloadEnvelopeInput evicted", {
      slot: payloadInput.slot,
      root: payloadInput.blockRootHex,
      reason,
    });
    this.serializedCache.delete(payloadInput.getSerializedCacheKeys());
    this.payloadInputs.delete(payloadInput.blockRootHex);
  }
}
