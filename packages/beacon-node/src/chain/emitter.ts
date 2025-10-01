import {EventEmitter} from "node:events";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {routes} from "@lodestar/api";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {RootHex, deneb, fulu, phase0} from "@lodestar/types";
import {PeerIdStr} from "../util/peerId.js";
import {BlockInputSource, IBlockInput} from "./blocks/blockInput/types.js";

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
  /**
   * This event signals that dependent services (e.g. custody sampling) should update to account for the new target group count.
   */
  updateTargetCustodyGroupCount = "updateTargetCustodyGroupCount",
  /**
   * This event signals that data columns have been fetched from the execution engine
   * and are ready to be published.
   */
  publishDataColumns = "publishDataColumns",
  /**
   * This event signals that blobs have been fetched from the execution engine
   * and are ready to be published.
   */
  publishBlobSidecars = "publishBlobSidecars",
  /**
   * Trigger an update of status so reqresp by peers have current earliestAvailableSlot
   */
  updateStatus = "updateStatus",
  /**
   * Trigger a BlockInputSync for blocks where the parentRoot is not known to fork choice
   */
  unknownParent = "unknownParent",
  /**
   * Trigger BlockInputSync for objects that correspond to a block that is not known to fork choice
   */
  unknownBlockRoot = "unknownBlockRoot",
  /**
   * Trigger BlockInputSync for blocks that are partially received via gossip but are not complete by time the
   * cut-off window passes for waiting on gossip
   */
  incompleteBlockInput = "incompleteBlockInput",
}

export type HeadEventData = routes.events.EventData[routes.events.EventType.head];
export type ReorgEventData = routes.events.EventData[routes.events.EventType.chainReorg];

// API events are emitted through the same ChainEventEmitter for re-use internally
type ApiEvents = {[K in routes.events.EventType]: (data: routes.events.EventData[K]) => void};

export type ChainEventData = {
  [ChainEvent.unknownParent]: {blockInput: IBlockInput; peer: PeerIdStr; source: BlockInputSource};
  [ChainEvent.unknownBlockRoot]: {rootHex: RootHex; peer?: PeerIdStr; source: BlockInputSource};
  [ChainEvent.incompleteBlockInput]: {blockInput: IBlockInput; peer: PeerIdStr; source: BlockInputSource};
};

export type IChainEvents = ApiEvents & {
  [ChainEvent.checkpoint]: (checkpoint: phase0.Checkpoint, state: CachedBeaconStateAllForks) => void;

  [ChainEvent.forkChoiceJustified]: (checkpoint: CheckpointWithHex) => void;
  [ChainEvent.forkChoiceFinalized]: (checkpoint: CheckpointWithHex) => void;

  [ChainEvent.updateTargetCustodyGroupCount]: (targetGroupCount: number) => void;

  [ChainEvent.publishDataColumns]: (sidecars: fulu.DataColumnSidecar[]) => void;

  [ChainEvent.publishBlobSidecars]: (sidecars: deneb.BlobSidecar[]) => void;

  [ChainEvent.updateStatus]: () => void;

  // Sync events that are chain->chain. Initiated from network requests but do not cross the network
  // barrier so are considered ChainEvent(s).
  [ChainEvent.unknownParent]: (data: ChainEventData[ChainEvent.unknownParent]) => void;
  [ChainEvent.unknownBlockRoot]: (data: ChainEventData[ChainEvent.unknownBlockRoot]) => void;
  [ChainEvent.incompleteBlockInput]: (data: ChainEventData[ChainEvent.incompleteBlockInput]) => void;
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
