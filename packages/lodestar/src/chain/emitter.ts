import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";

import {
  Attestation,
  Checkpoint,
  Epoch,
  ForkDigest,
  Root,
  SignedBeaconBlock,
  SignedVoluntaryExit,
  Slot,
} from "@chainsafe/lodestar-types";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {ITreeStateContext} from "../db/api/beacon/stateContextCache";
import {IBlockJob} from "./interface";
import {AttestationError, BlockError} from "./errors";

export interface IChainEvents {
  // old, to be deprecated
  forkVersion: () => void;

  // new
  attestation: (attestation: Attestation) => void;
  block: (signedBlock: SignedBeaconBlock, postStateContext: ITreeStateContext, job: IBlockJob) => void;
  checkpoint: (checkpoint: Checkpoint, stateContext: ITreeStateContext) => void;
  justified: (checkpoint: Checkpoint, stateContext: ITreeStateContext) => void;
  finalized: (checkpoint: Checkpoint, stateContext: ITreeStateContext) => void;
  voluntaryExit: (exit: SignedVoluntaryExit) => void;
  forkDigest: (forkDigest: ForkDigest) => void;

  "clock:slot": (slot: Slot) => void;
  "clock:epoch": (epoch: Epoch) => void;

  "error:block": (error: BlockError) => void;
  "error:attestation": (error: AttestationError) => void;

  "forkChoice:head": (head: IBlockSummary) => void;
  "forkChoice:reorg": (head: IBlockSummary, oldHead: IBlockSummary, depth: number) => void;
  "forkChoice:justified": (checkpoint: Checkpoint) => void;
  "forkChoice:finalized": (checkpoint: Checkpoint) => void;

  "block:unknownRoot": (root: Root) => void;
  // TODO more events
}

export class ChainEventEmitter extends (EventEmitter as {new (): StrictEventEmitter<EventEmitter, IChainEvents>}) {}
