import {CheckpointWithHex} from "@lodestar/fork-choice";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex, Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {SerializedCache} from "../../util/serializedCache.js";
import {CreateFromBlockProps, PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";

export type {PayloadEnvelopeInputState} from "../blocks/payloadEnvelopeInput/index.js";
export {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";

export type SeenPayloadEnvelopeInputModules = {
  chainEvents: ChainEventEmitter;
  signal: AbortSignal;
  serializedCache: SerializedCache;
  metrics: Metrics | null;
  logger?: Logger;
};

/**
 * Cache for tracking PayloadEnvelopeInput instances, keyed by beacon block root.
 *
 * Created during block import when a block is processed. Two pruning paths:
 *   - `prepareNextSlot` calls `pruneBelow(headParentSlot)` every slot once the head we'll build
 *     on is known.
 *   - `onFinalized` calls `pruneBelow(finalizedSlot)` on every finalization for bulk cleanup.
 *
 * Steady state (linear chain, healthy progression): the cache holds ~2 entries — the head
 * (parent for next-slot production) and its parent (proposer-boost-reorg fallback). It can
 * transiently hold more during forks, range-sync bursts, or when `prepareNextSlot` skips
 * ticks; subsequent ticks settle it back.
 *
 * Consumers that miss the cache fall back to DB (`chain.getParentExecutionRequests` /
 * `getExecutionPayloadEnvelope`). The authoritative view of "does this block / payload exist
 * in the canonical chain" is `forkChoice` — this cache is a latency optimisation for the
 * synchronous fast path, not a source of truth.
 */
export class SeenPayloadEnvelopeInput {
  private readonly chainEvents: ChainEventEmitter;
  private readonly signal: AbortSignal;
  private readonly serializedCache: SerializedCache;
  private readonly metrics: Metrics | null;
  private readonly logger?: Logger;
  private payloadInputs = new Map<RootHex, PayloadEnvelopeInput>();

  constructor({chainEvents, signal, serializedCache, metrics, logger}: SeenPayloadEnvelopeInputModules) {
    this.chainEvents = chainEvents;
    this.signal = signal;
    this.serializedCache = serializedCache;
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

    this.chainEvents.on(ChainEvent.forkChoiceFinalized, this.onFinalized);
    this.signal.addEventListener("abort", () => {
      this.chainEvents.off(ChainEvent.forkChoiceFinalized, this.onFinalized);
    });
  }

  private onFinalized = (checkpoint: CheckpointWithHex): void => {
    this.pruneBelow(computeStartSlotAtEpoch(checkpoint.epoch));
  };

  add(props: CreateFromBlockProps): PayloadEnvelopeInput {
    if (this.payloadInputs.has(props.blockRootHex)) {
      throw new Error(`PayloadEnvelopeInput already exists for block ${props.blockRootHex}`);
    }
    const input = PayloadEnvelopeInput.createFromBlock(props);
    this.payloadInputs.set(props.blockRootHex, input);
    this.metrics?.seenCache.payloadEnvelopeInput.created.inc();
    return input;
  }

  get(blockRootHex: RootHex): PayloadEnvelopeInput | undefined {
    return this.payloadInputs.get(blockRootHex);
  }

  hasPayload(blockRootHex: RootHex): boolean {
    return this.payloadInputs.get(blockRootHex)?.hasPayloadEnvelope() ?? false;
  }

  size(): number {
    return this.payloadInputs.size;
  }

  pruneBelow(slot: Slot): void {
    let deletedCount = 0;
    for (const [, input] of this.payloadInputs) {
      if (input.slot < slot) {
        this.evictPayloadInput(input);
        deletedCount++;
      }
    }
    this.logger?.debug("SeenPayloadEnvelopeInput.pruneBelow deleted entries", {slot, deletedCount});
  }

  private evictPayloadInput(payloadInput: PayloadEnvelopeInput): void {
    this.serializedCache.delete(payloadInput.getSerializedCacheKeys());
    this.payloadInputs.delete(payloadInput.blockRootHex);
  }
}
