import {EventEmitter} from "events";

import {Checkpoint, Slot} from "@chainsafe/lodestar-types";
import {IForkChoiceStore} from "@chainsafe/lodestar-fork-choice";
import {ChainEventEmitter} from "../../chain";

/**
 * IForkChoiceStore implementer which emits forkChoice events on updated justified and finalized checkpoints.
 */
export class ForkChoiceStore implements IForkChoiceStore {
  public currentSlot: Slot;
  public bestJustifiedCheckpoint: Checkpoint;

  private _justifiedCheckpoint: Checkpoint;
  private _finalizedCheckpoint: Checkpoint;
  private emitter: EventEmitter;
  constructor({
    emitter,
    currentSlot,
    justifiedCheckpoint,
    finalizedCheckpoint,
  }: {
    emitter: ChainEventEmitter;
    currentSlot: Slot;
    justifiedCheckpoint: Checkpoint;
    finalizedCheckpoint: Checkpoint;
  }) {
    this.emitter = emitter;
    this.currentSlot = currentSlot;
    this.bestJustifiedCheckpoint = justifiedCheckpoint;
    this._justifiedCheckpoint = justifiedCheckpoint;
    this._finalizedCheckpoint = finalizedCheckpoint;
  }

  public get justifiedCheckpoint(): Checkpoint {
    return this._justifiedCheckpoint;
  }

  public set justifiedCheckpoint(checkpoint: Checkpoint) {
    this._justifiedCheckpoint = checkpoint;
    this.emitter.emit("forkChoice:justified", checkpoint);
  }

  public get finalizedCheckpoint(): Checkpoint {
    return this._finalizedCheckpoint;
  }

  public set finalizedCheckpoint(checkpoint: Checkpoint) {
    this._finalizedCheckpoint = checkpoint;
    this.emitter.emit("forkChoice:finalized", checkpoint);
  }
}
