import {CheckpointWithHex} from "@lodestar/fork-choice";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
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
 * Created during block import when a block is processed.
 * Pruned on finalization only — entries below the finalized slot are evicted in `onFinalized`.
 * (Per-block pruning after DB persist is intentionally NOT done; synchronous consumers like
 * `produceBlockBody.prepareExecutionPayload` and `chain.getParentExecutionRequests` still
 * read the envelope from here. See `writePayloadEnvelopeInputToDb.persistPayloadEnvelopeInput`
 * for the full rationale.)
 *
 * TODO GLOAS: the cache is currently unbounded between finalizations. During non-finality it
 * can grow without limit (one entry per unfinalized block, dominated by the ~128 sampled data
 * columns per entry). Cap to a max size (e.g. slot-ordered LRU of a few hundred entries) and
 * evict oldest-first when the cap is exceeded. Consumers that miss the cache must then fall
 * back to DB reads (`chain.getExecutionPayloadEnvelope` already does this for serialised bytes;
 * the block-producer code paths would need an async variant). The authoritative view of "does
 * this block / payload exist in the canonical chain" is `forkChoice` — this cache is a latency
 * optimisation for the synchronous callers, not a source of truth.
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
    // Prune all entries with slot < finalized slot
    const finalizedSlot = computeStartSlotAtEpoch(checkpoint.epoch);
    let deletedCount = 0;
    for (const [, input] of this.payloadInputs) {
      if (input.slot < finalizedSlot) {
        this.evictPayloadInput(input);
        deletedCount++;
      }
    }
    this.logger?.debug("SeenPayloadEnvelopeInput.onFinalized deleted cached entries", {deletedCount});
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

  private evictPayloadInput(payloadInput: PayloadEnvelopeInput): void {
    this.serializedCache.delete(payloadInput.getSerializedCacheKeys());
    this.payloadInputs.delete(payloadInput.blockRootHex);
  }
}
