import {CheckpointWithHex} from "@lodestar/fork-choice";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {CreateFromBlockProps, PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";

export type {PayloadEnvelopeInputState} from "../blocks/payloadEnvelopeInput/index.js";
// Re-export for convenience
export {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";

/**
 * Modules required for SeenPayloadEnvelopeInput.
 */
export type SeenPayloadEnvelopeInputModules = {
  chainEvents: ChainEventEmitter;
  signal: AbortSignal;
  metrics: Metrics | null;
  logger?: Logger;
};

/**
 * Cache for tracking PayloadEnvelopeInput instances, keyed by beacon block root.
 *
 * Created during block import when a Gloas block is processed.
 * Pruned on finalization and after payload is written to DB.
 */
export class SeenPayloadEnvelopeInput {
  private readonly chainEvents: ChainEventEmitter;
  private readonly signal: AbortSignal;
  private readonly logger?: Logger;
  private payloadInputs = new Map<RootHex, PayloadEnvelopeInput>();

  constructor({chainEvents, signal, metrics, logger}: SeenPayloadEnvelopeInputModules) {
    this.chainEvents = chainEvents;
    this.signal = signal;
    this.logger = logger;

    if (metrics) {
      metrics.seenCache.payloadEnvelopeInput.count.addCollect(() =>
        metrics.seenCache.payloadEnvelopeInput.count.set(this.payloadInputs.size)
      );
    }

    this.chainEvents.on(ChainEvent.forkChoiceFinalized, this.onFinalized);
    this.signal.addEventListener("abort", () => {
      this.chainEvents.off(ChainEvent.forkChoiceFinalized, this.onFinalized);
    });
  }

  /**
   * Handle finalization - prune entries for finalized slots.
   */
  private onFinalized = (checkpoint: CheckpointWithHex): void => {
    // Prune all entries with slot <= finalized slot
    const finalizedSlot = computeStartSlotAtEpoch(checkpoint.epoch);
    let deletedCount = 0;
    for (const [rootHex, input] of this.payloadInputs) {
      if (input.slot <= finalizedSlot) {
        this.payloadInputs.delete(rootHex);
        deletedCount++;
      }
    }
    this.logger?.debug(`SeenPayloadEnvelopeInput.onFinalized deleted ${deletedCount} cached entries`);
  };

  /**
   * Create and store a new PayloadEnvelopeInput during block import.
   * Throws if input already exists for this block root.
   */
  add(props: CreateFromBlockProps): PayloadEnvelopeInput {
    if (this.payloadInputs.has(props.blockRootHex)) {
      throw new Error(`PayloadEnvelopeInput already exists for block ${props.blockRootHex}`);
    }
    const input = PayloadEnvelopeInput.createFromBlock(props);
    this.payloadInputs.set(props.blockRootHex, input);
    return input;
  }

  /**
   * Get existing PayloadEnvelopeInput by block root.
   * Returns undefined if block hasn't been imported yet.
   */
  get(blockRootHex: RootHex): PayloadEnvelopeInput | undefined {
    return this.payloadInputs.get(blockRootHex);
  }

  /**
   * Check if PayloadEnvelopeInput exists for block root.
   */
  has(blockRootHex: RootHex): boolean {
    return this.payloadInputs.has(blockRootHex);
  }

  /**
   * Remove PayloadEnvelopeInput after payload is written to DB.
   */
  delete(blockRootHex: RootHex): boolean {
    return this.payloadInputs.delete(blockRootHex);
  }

  /**
   * Get the current size of the cache.
   */
  size(): number {
    return this.payloadInputs.size;
  }
}
