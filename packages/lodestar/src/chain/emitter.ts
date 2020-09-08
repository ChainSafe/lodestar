import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";

import {Attestation, Checkpoint, Epoch, ForkDigest, Root, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";

export interface IChainEvents {
  // old, to be deprecated
  unknownBlockRoot: (root: Root) => void;
  block: (signedBlock: SignedBeaconBlock) => void;
  checkpoint: (checkpoint: Checkpoint) => void;
  attestation: (attestation: Attestation) => void;
  justified: (checkpoint: Checkpoint) => void;
  finalized: (checkpoint: Checkpoint) => void;
  forkVersion: () => void;
  forkDigest: (forkDigest: ForkDigest) => void;

  // new
  "clock:slot": (slot: Slot) => void;
  "clock:epoch": (epoch: Epoch) => void;

  "forkChoice:head": (head: IBlockSummary) => void;
  "forkChoice:reorg": (head: IBlockSummary, oldHead: IBlockSummary) => void;
  "forkChoice:prune": (finalized: IBlockSummary, pruned: IBlockSummary[]) => void;
  "forkChoice:justified": (checkpoint: Checkpoint) => void;
  "forkChoice:finalized": (checkpoint: Checkpoint) => void;
  // TODO more events
}

export class ChainEventEmitter extends (EventEmitter as {new (): StrictEventEmitter<EventEmitter, IChainEvents>}) {}
