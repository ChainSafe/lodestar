import {EventEmitter} from "events";

import {phase0, Slot} from "@chainsafe/lodestar-types";
import {IForkChoiceStore} from "@chainsafe/lodestar-fork-choice";
import {ChainEventEmitter} from "../../chain";
import {ChainEvent} from "../emitter";

/**
 * IForkChoiceStore implementer which emits forkChoice events on updated justified and finalized checkpoints.
 */
export class ForkChoiceStore implements IForkChoiceStore {
  currentSlot: Slot;
  bestJustifiedCheckpoint: phase0.Checkpoint;

  private _justifiedCheckpoint: phase0.Checkpoint;
  private _finalizedCheckpoint: phase0.Checkpoint;
  private emitter: EventEmitter;
  constructor({
    emitter,
    currentSlot,
    justifiedCheckpoint,
    finalizedCheckpoint,
  }: {
    emitter: ChainEventEmitter;
    currentSlot: Slot;
    justifiedCheckpoint: phase0.Checkpoint;
    finalizedCheckpoint: phase0.Checkpoint;
  }) {
    this.emitter = emitter;
    this.currentSlot = currentSlot;
    this.bestJustifiedCheckpoint = justifiedCheckpoint;
    this._justifiedCheckpoint = justifiedCheckpoint;
    this._finalizedCheckpoint = finalizedCheckpoint;
  }

  get justifiedCheckpoint(): phase0.Checkpoint {
    return this._justifiedCheckpoint;
  }

  set justifiedCheckpoint(checkpoint: phase0.Checkpoint) {
    this._justifiedCheckpoint = checkpoint;
    this.emitter.emit(ChainEvent.forkChoiceJustified, checkpoint);
  }

  get finalizedCheckpoint(): phase0.Checkpoint {
    return this._finalizedCheckpoint;
  }

  set finalizedCheckpoint(checkpoint: phase0.Checkpoint) {
    this._finalizedCheckpoint = checkpoint;
    this.emitter.emit(ChainEvent.forkChoiceFinalized, checkpoint);
  }
}
