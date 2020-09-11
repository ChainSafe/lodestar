import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";

import {Attestation, Checkpoint, Epoch, ForkDigest, Root, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {ITreeStateContext} from "../db/api/beacon/stateContextCache";
import {BlockError} from "./interface";

export interface IChainEvents {
  // old, to be deprecated
  unknownBlockRoot: (root: Root) => void;
  block: (signedBlock: SignedBeaconBlock) => void;
  checkpoint: (checkpoint: Checkpoint, stateContext: ITreeStateContext) => void;
  attestation: (attestation: Attestation) => void;
  justified: (checkpoint: Checkpoint) => void;
  finalized: (checkpoint: Checkpoint) => void;
  forkVersion: () => void;
  forkDigest: (forkDigest: ForkDigest) => void;

  // new
  "clock:slot": (slot: Slot) => void;
  "clock:epoch": (epoch: Epoch) => void;

  "error:block": (error: BlockError) => void;

  "forkChoice:head": (head: IBlockSummary) => void;
  "forkChoice:reorg": (head: IBlockSummary, oldHead: IBlockSummary) => void;
  "forkChoice:justified": (checkpoint: Checkpoint) => void;
  "forkChoice:finalized": (checkpoint: Checkpoint) => void;
  // TODO more events
}

export class ChainEventEmitter extends (EventEmitter as {new (): StrictEventEmitter<EventEmitter, IChainEvents>}) {}
