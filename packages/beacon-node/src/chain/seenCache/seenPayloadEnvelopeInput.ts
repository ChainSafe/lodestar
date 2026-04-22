import {CheckpointWithHex} from "@lodestar/fork-choice";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex, Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {SerializedCache} from "../../util/serializedCache.js";
import {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {CreateFromBlockProps} from "../blocks/payloadEnvelopeInput/types.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";

export type {PayloadEnvelopeInputState} from "../blocks/payloadEnvelopeInput/index.js";
export {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";

export type SeenPayloadEnvelopeInputModules = {
  chainEvents: ChainEventEmitter;
  signal: AbortSignal;
  serializedCache: SerializedCache;
  hasValidatedPayload: (blockRootHex: RootHex) => boolean;
  metrics: Metrics | null;
  logger?: Logger;
};

/**
 * Cache for tracking PayloadEnvelopeInput instances, keyed by beacon block root.
 *
 * Created during block import when a Gloas block is processed. Entries stay resident until the
 * block's payload is validated in fork choice, so later envelope / column validation can reuse
 * the same PayloadEnvelopeInput created by importBlock(). Once a payload is validated, older
 * entries can be evicted on finalization.
 */
export class SeenPayloadEnvelopeInput {
  private readonly chainEvents: ChainEventEmitter;
  private readonly signal: AbortSignal;
  private readonly serializedCache: SerializedCache;
  private readonly hasValidatedPayload: (blockRootHex: RootHex) => boolean;
  private readonly metrics: Metrics | null;
  private readonly logger?: Logger;
  private payloadInputs = new Map<RootHex, PayloadEnvelopeInput>();

  constructor({
    chainEvents,
    signal,
    serializedCache,
    hasValidatedPayload,
    metrics,
    logger,
  }: SeenPayloadEnvelopeInputModules) {
    this.chainEvents = chainEvents;
    this.signal = signal;
    this.serializedCache = serializedCache;
    this.hasValidatedPayload = hasValidatedPayload;
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

  prune(blockRootHex: RootHex): void {
    const payloadInput = this.payloadInputs.get(blockRootHex);
    if (payloadInput) {
      this.evictPayloadInput(payloadInput);
    }
  }

  size(): number {
    return this.payloadInputs.size;
  }

  pruneBelow(slot: Slot): void {
    let deletedCount = 0;
    let retainedUnvalidatedCount = 0;
    for (const [, input] of this.payloadInputs) {
      if (input.slot >= slot) {
        continue;
      }

      if (!this.hasValidatedPayload(input.blockRootHex)) {
        retainedUnvalidatedCount++;
        continue;
      }

      this.evictPayloadInput(input);
      deletedCount++;
    }
    this.logger?.debug("SeenPayloadEnvelopeInput.pruneBelow deleted entries", {
      slot,
      deletedCount,
      retainedUnvalidatedCount,
    });
  }

  private evictPayloadInput(payloadInput: PayloadEnvelopeInput): void {
    this.serializedCache.delete(payloadInput.getSerializedCacheKeys());
    this.payloadInputs.delete(payloadInput.blockRootHex);
  }
}
