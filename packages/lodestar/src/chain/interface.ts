import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";

import {
  Attestation,
  BeaconState,
  Checkpoint,
  ENRForkID,
  ForkDigest, HeadResponse,
  Root,
  SignedBeaconBlock,
  Slot,
  Uint16,
  Uint64,
} from "@chainsafe/lodestar-types";

import {ILMDGHOST} from "./forkChoice";
import {IBeaconClock} from "./clock/interface";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked} from "@chainsafe/ssz";
import {ITreeStateContext} from "../db/api/beacon/stateContextCache";

export interface IChainEvents {
  unknownBlockRoot: (root: Root) => void;
  processedBlock: (signedBlock: SignedBeaconBlock) => void;
  processedCheckpoint: (checkPoint: Checkpoint) => void;
  processedAttestation: (attestation: Attestation) => void;
  justifiedCheckpoint: (checkpoint: Checkpoint) => void;
  finalizedCheckpoint: (checkpoint: Checkpoint) => void;
  forkVersion: () => void;
  forkDigest: (forkDigest: ForkDigest) => void;
}

export type ChainEventEmitter = StrictEventEmitter<EventEmitter, IChainEvents>;

/**
 * The IBeaconChain service deals with processing incoming blocks, advancing a state transition
 * and applying the fork choice rule to update the chain head
 */
export interface IBeaconChain extends ChainEventEmitter {
  forkChoice: ILMDGHOST;
  clock: IBeaconClock;
  chainId: Uint16;
  networkId: Uint64;
  currentForkDigest: ForkDigest;
  /**
   * Start beacon chain processing
   */
  start(): Promise<void>;

  /**
   * Stop beacon chain processing
   */
  stop(): Promise<void>;

  /**
   * Return ENRForkID.
   */
  getENRForkID(): Promise<ENRForkID>;

  getHeadStateContext(): Promise<ITreeStateContext>;
  getHeadState(): Promise<TreeBacked<BeaconState>>;
  getHeadEpochContext(): Promise<EpochContext>;

  getHeadBlock(): Promise<SignedBeaconBlock|null>;

  getFinalizedCheckpoint(): Promise<Checkpoint>;

  getHead(): Promise<HeadResponse>;

  getBlockAtSlot(slot: Slot): Promise<SignedBeaconBlock|null>;

  getUnfinalizedBlocksAtSlots(slots: Slot[]): Promise<SignedBeaconBlock[]|null>;

  /**
   * Add attestation to the fork-choice rule
   */
  receiveAttestation(attestation: Attestation): Promise<void>;

  /**
   * Pre-process and run the per slot state transition function
   */
  receiveBlock(signedBlock: SignedBeaconBlock, trusted?: boolean): Promise<void>;

  /**
   * Initialize the chain with a genesis state
   */
  initializeBeaconChain(genesisState: TreeBacked<BeaconState>): Promise<void>;
}

export interface IAttestationProcessor {
  receiveBlock(signedBlock: SignedBeaconBlock, trusted?: boolean): Promise<void>;
  receiveAttestation(attestation: Attestation): Promise<void>;
}
