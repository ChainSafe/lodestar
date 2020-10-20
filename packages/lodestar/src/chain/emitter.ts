import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";

import {
  Attestation,
  Checkpoint,
  Epoch,
  SignedBeaconBlock,
  SignedVoluntaryExit,
  Slot,
  Version,
} from "@chainsafe/lodestar-types";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {ITreeStateContext} from "../db/api/beacon/stateContextCache";
import {IBlockJob} from "./interface";
import {AttestationError, BlockError} from "./errors";

export enum ChainEvent {
  attestation = "attestation",
  block = "block",
  checkpoint = "checkpoint",
  justified = "justified",
  finalized = "finalized",
  voluntaryExit = "voluntaryExit",
  forkDigest = "forkDigest",
  clockSlot = "clock:slot",
  clockEpoch = "clock:epoch",
  errorBlock = "error:block",
  errorAttestation = "error:attestation",
  forkChoiceHead = "forkChoice:head",
  forkChoiceReorg = "forkChoice:reorg",
  forkChoiceJustified = "forkChoice:justified",
  forkChoiceFinalized = "forkChoice:finalized",
}

export interface IChainEvents {
  attestation: (attestation: Attestation) => void;
  block: (signedBlock: SignedBeaconBlock, postStateContext: ITreeStateContext, job: IBlockJob) => void;
  checkpoint: (checkpoint: Checkpoint, stateContext: ITreeStateContext) => void;
  justified: (checkpoint: Checkpoint, stateContext: ITreeStateContext) => void;
  finalized: (checkpoint: Checkpoint, stateContext: ITreeStateContext) => void;
  voluntaryExit: (exit: SignedVoluntaryExit) => void;
  forkVersion: (version: Version) => void;

  "clock:slot": (slot: Slot) => void;
  "clock:epoch": (epoch: Epoch) => void;

  "error:block": (error: BlockError) => void;
  "error:attestation": (error: AttestationError) => void;

  "forkChoice:head": (head: IBlockSummary) => void;
  "forkChoice:reorg": (head: IBlockSummary, oldHead: IBlockSummary, depth: number) => void;
  "forkChoice:justified": (checkpoint: Checkpoint) => void;
  "forkChoice:finalized": (checkpoint: Checkpoint) => void;
}

export class ChainEventEmitter extends (EventEmitter as {new (): StrictEventEmitter<EventEmitter, IChainEvents>}) {}
