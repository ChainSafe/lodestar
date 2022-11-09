import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";

import {routes} from "@lodestar/api";
import {phase0, Epoch, Slot, allForks, altair} from "@lodestar/types";
import {CheckpointWithHex, ProtoBlock} from "@lodestar/fork-choice";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";

/**
 * Important chain events that occur during normal chain operation.
 *
 * Chain events can be broken into several categories:
 * - Clock: the chain's clock is updated
 * - Fork Choice: the chain's fork choice is updated
 * - Processing: the chain processes attestations and blocks, either successfully or with an error
 * - Checkpointing: the chain processes epoch boundaries
 */
export enum ChainEvent {
  /**
   * This event signals that the chain has successfully processed a valid attestation.
   *
   * This event is guaranteed to be emitted after every attestation fed to the chain has successfully been passed to the fork choice.
   */
  attestation = "attestation",
  /** The node has received a valid sync committee SignedContributionAndProof (from P2P or API) */
  contributionAndProof = "contribution_and_proof",
  /**
   * This event signals that the chain has successfully processed a valid block.
   *
   * This event is guaranteed to be emitted after every block fed to the chain has successfully passed the state transition.
   */
  block = "block",
  /**
   * This event signals that the chain has processed (or reprocessed) a checkpoint.
   *
   * This event is not tied to clock events, but rather tied to generation (or regeneration) of state.
   * This event is guaranteed to be called after _any_ checkpoint is processed, including skip-slot checkpoints, checkpoints that are formed as a result of processing blocks, etc.
   */
  checkpoint = "checkpoint",
  /**
   * This event signals that the chain has processed (or reprocessed) a checkpoint state with an updated justified checkpoint.
   *
   * This event is a derivative of the `checkpoint` event. Eg: in cases where the `checkpoint` state has an updated justified checkpoint, this event is triggered.
   */
  justified = "justified",
  /**
   * This event signals that the chain has processed (or reprocessed) a checkpoint state with an updated finalized checkpoint.
   *
   * This event is a derivative of the `checkpoint` event. Eg: in cases where the `checkpoint` state has an updated finalized checkpoint, this event is triggered.
   */
  finalized = "finalized",
  /**
   * This event signals the start of a new slot, and that subsequent calls to `clock.currentSlot` will equal `slot`.
   *
   * This event is guaranteed to be emitted every `SECONDS_PER_SLOT` seconds.
   */
  clockSlot = "clock:slot",
  /**
   * This event signals the start of a new epoch, and that subsequent calls to `clock.currentEpoch` will return `epoch`.
   *
   * This event is guaranteed to be emitted every `SECONDS_PER_SLOT * SLOTS_PER_EPOCH` seconds.
   */
  clockEpoch = "clock:epoch",
  /**
   * This event signals that the fork choice has been updated to a new head.
   *
   * This event is guaranteed to be emitted after every sucessfully processed block, if that block updates the head.
   */
  head = "forkChoice:head",
  /**
   * This event signals that the fork choice has been updated to a new head that is not a descendant of the previous head.
   *
   * This event is guaranteed to be emitted after every sucessfully processed block, if that block results results in a reorg.
   */
  forkChoiceReorg = "forkChoice:reorg",
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
  /**
   * A new lightclient optimistic header update is available to be broadcasted to connected light-clients
   */
  lightClientOptimisticUpdate = "lightclient:header_update",
  /**
   * A new lightclient finalized header update is available to be broadcasted to connected light-clients
   */
  lightClientFinalityUpdate = "lightclient:finality_update",
  /**
   * A new lightclient update is available to be broadcasted to connected light-clients
   */
  lightClientUpdate = "lightclient:update",
}

export type HeadEventData = routes.events.EventData[routes.events.EventType.head];

export interface IChainEvents {
  [ChainEvent.attestation]: (attestation: phase0.Attestation) => void;
  [ChainEvent.contributionAndProof]: (contributionAndProof: altair.SignedContributionAndProof) => void;
  [ChainEvent.block]: (signedBlock: allForks.SignedBeaconBlock, postState: CachedBeaconStateAllForks) => void;

  [ChainEvent.checkpoint]: (checkpoint: phase0.Checkpoint, state: CachedBeaconStateAllForks) => void;
  [ChainEvent.justified]: (checkpoint: phase0.Checkpoint, state: CachedBeaconStateAllForks) => void;
  [ChainEvent.finalized]: (checkpoint: phase0.Checkpoint, state: CachedBeaconStateAllForks) => void;

  [ChainEvent.clockSlot]: (slot: Slot) => void;
  [ChainEvent.clockEpoch]: (epoch: Epoch) => void;

  [ChainEvent.head]: (data: HeadEventData) => void;
  [ChainEvent.forkChoiceReorg]: (head: ProtoBlock, oldHead: ProtoBlock, depth: number) => void;
  [ChainEvent.forkChoiceJustified]: (checkpoint: CheckpointWithHex) => void;
  [ChainEvent.forkChoiceFinalized]: (checkpoint: CheckpointWithHex) => void;

  [ChainEvent.lightClientOptimisticUpdate]: (optimisticUpdate: altair.LightClientOptimisticUpdate) => void;
  [ChainEvent.lightClientFinalityUpdate]: (finalizedUpdate: altair.LightClientFinalityUpdate) => void;
  [ChainEvent.lightClientUpdate]: (update: altair.LightClientUpdate) => void;
}

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
