import {EventEmitter} from "node:events";
import {StrictEventEmitter} from "strict-event-emitter-types";

import {routes} from "@lodestar/api";
import {phase0} from "@lodestar/types";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";

/**
 * Important chain events that occur during normal chain operation.
 *
 * Chain events can be broken into several categories:
 * - Clock: the chain's clock is updated
 * - Fork Choice: the chain's fork choice is updated
 * - Checkpointing: the chain processes epoch boundaries
 */
export enum ChainEvent {
  /**
   * This event signals that the chain has processed (or reprocessed) a checkpoint.
   *
   * This event is not tied to clock events, but rather tied to generation (or regeneration) of state.
   * This event is guaranteed to be called after _any_ checkpoint is processed, including skip-slot checkpoints, checkpoints that are formed as a result of processing blocks, etc.
   */
  checkpoint = "checkpoint",
  /**
   * This event signals that the fork choice store has been updated.
   *
   * This event is guaranteed to be triggered whenever the fork choice justified checkpoint is updated. This is either in response to a newly processed block or a new clock tick.
   */
  forkChoiceJustified = "forkChoice:justified",
  /**
   * This event signals that the fork choice store has been updated.
   *
   * This event is guaranteed to be triggered whenever the fork choice justified checkpoint is updated. This is in response to a newly processed block.
   */
  forkChoiceFinalized = "forkChoice:finalized",
}

export type HeadEventData = routes.events.EventData[routes.events.EventType.head];
export type ReorgEventData = routes.events.EventData[routes.events.EventType.chainReorg];

// API events are emitted through the same ChainEventEmitter for re-use internally
type ApiEvents = {[K in routes.events.EventType]: (data: routes.events.EventData[K]) => void};

export type IChainEvents = ApiEvents & {
  [ChainEvent.checkpoint]: (checkpoint: phase0.Checkpoint, state: CachedBeaconStateAllForks) => void;

  [ChainEvent.forkChoiceJustified]: (checkpoint: CheckpointWithHex) => void;
  [ChainEvent.forkChoiceFinalized]: (checkpoint: CheckpointWithHex) => void;
};

/**
 * Emits important chain events that occur during normal chain operation.
 *
 * Chain events can be broken into several categories:
 * - Clock: the chain's clock is updated
 * - Fork Choice: the chain's fork choice is updated
 * - Processing: the chain processes attestations and blocks, either successfully or with an error
 * - Checkpointing: the chain processes epoch boundaries
 */
export class ChainEventEmitter extends (EventEmitter as {new (): StrictEventEmitter<EventEmitter, IChainEvents>}) {}
