import {ChainForkConfig} from "@lodestar/config";
import {CheckpointWithHex, IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {IClock} from "../../util/clock.js";
import {SerializedCache} from "../../util/serializedCache.js";
import {isDaOutOfRange} from "../blocks/blockInput/index.js";
import {CreateFromBlockProps, PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";

export type {PayloadEnvelopeInputState} from "../blocks/payloadEnvelopeInput/index.js";
export {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";

export type SeenPayloadEnvelopeInputModules = {
  config: ChainForkConfig;
  clock: IClock;
  forkChoice: IForkChoice;
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
 */
export class SeenPayloadEnvelopeInput {
  private readonly config: ChainForkConfig;
  private readonly clock: IClock;
  private readonly forkChoice: IForkChoice;
  private readonly chainEvents: ChainEventEmitter;
  private readonly signal: AbortSignal;
  private readonly serializedCache: SerializedCache;
  private readonly metrics: Metrics | null;
  private readonly logger?: Logger;
  private payloadInputs = new Map<RootHex, PayloadEnvelopeInput>();

  constructor({
    config,
    clock,
    forkChoice,
    chainEvents,
    signal,
    serializedCache,
    metrics,
    logger,
  }: SeenPayloadEnvelopeInputModules) {
    this.config = config;
    this.clock = clock;
    this.forkChoice = forkChoice;
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
        this.evictPayloadInput(input);
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
    this.metrics?.seenCache.payloadEnvelopeInput.created.inc();
    this.logger?.verbose("SeenPayloadEnvelopeInput.add created new entry", {
      slot: input.slot,
      root: props.blockRootHex,
      daOutOfRange,
    });
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

  pruneBelowParent(parentBlock: ProtoBlock): void {
    for (const block of this.forkChoice.getAllAncestorBlocks(parentBlock.blockRoot, parentBlock.payloadStatus)) {
      if (block.slot < parentBlock.slot) {
        const input = this.payloadInputs.get(block.blockRoot);
        if (input) {
          this.evictPayloadInput(input);
        }
      }
      this.logger?.debug("SeenPayloadEnvelopeInput.pruneBelowParent deleted", {
        slot: block.slot,
        root: block.blockRoot,
      });
    }
  }

  private evictPayloadInput(payloadInput: PayloadEnvelopeInput): void {
    this.serializedCache.delete(payloadInput.getSerializedCacheKeys());
    this.payloadInputs.delete(payloadInput.blockRootHex);
  }
}
