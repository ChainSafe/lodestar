import {
  Attestation,
  BeaconState,
  Checkpoint,
  ENRForkID,
  ForkDigest,
  Number64,
  Root,
  SignedBeaconBlock,
  Slot,
} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {IBeaconClock} from "./clock/interface";
import {ITreeStateContext} from "../db/api/beacon/stateContextCache";
import {ChainEventEmitter} from "./emitter";
import {IStateRegenerator} from "./regen";
import {BlockPool} from "./blocks";
import {AttestationPool} from "./attestation";

export interface IBlockJob {
  signedBlock: SignedBeaconBlock;
  /**
   * Metadata: lets a block thats already been processed to be processed again.
   * After processing, the block will not be stored in the database
   */
  reprocess: boolean;
  /**
   * blocks fed to the processor that occur before the best known finalized checkpoint
   */
  prefinalized: boolean;
  /**
   * Metadata: `true` if only the block proposer signature has been verified
   */
  validProposerSignature: boolean;
  /**
   * Metadata: `true` if all the signatures including the proposer signature have been verified
   */
  validSignatures: boolean;
}

export interface IAttestationJob {
  attestation: Attestation;
  /**
   * `true` if the signature has already been verified
   */
  validSignature: boolean;
}

/**
 * The IBeaconChain service deals with processing incoming blocks, advancing a state transition
 * and applying the fork choice rule to update the chain head
 */
export interface IBeaconChain {
  emitter: ChainEventEmitter;
  clock: IBeaconClock;
  forkChoice: IForkChoice;
  regen: IStateRegenerator;
  pendingBlocks: BlockPool;
  pendingAttestations: AttestationPool;

  /**
   * Stop beacon chain processing
   */
  close(): Promise<void>;

  /**
   * Get ForkDigest from the head state
   */
  getForkDigest(): Promise<ForkDigest>;
  /**
   * Get ENRForkID from the head state
   */
  getENRForkID(): Promise<ENRForkID>;
  getGenesisTime(): Number64;
  getHeadStateContext(): Promise<ITreeStateContext>;
  getHeadStateContextAtCurrentEpoch(): Promise<ITreeStateContext>;
  getHeadStateContextAtCurrentSlot(): Promise<ITreeStateContext>;
  getHeadState(): Promise<TreeBacked<BeaconState>>;
  getHeadEpochContext(): Promise<EpochContext>;
  getHeadBlock(): Promise<SignedBeaconBlock | null>;

  getStateContextByBlockRoot(blockRoot: Root): Promise<ITreeStateContext | null>;

  getFinalizedCheckpoint(): Promise<Checkpoint>;

  /**
   * Since we can have multiple parallel chains,
   * this methods returns blocks in current chain head according to
   * forkchoice. Works for finalized slots as well
   * @param slot
   */
  getCanonicalBlockAtSlot(slot: Slot): Promise<SignedBeaconBlock | null>;

  getUnfinalizedBlocksAtSlots(slots: Slot[]): Promise<SignedBeaconBlock[] | null>;

  /**
   * Pre-process and run the per slot state transition function
   */
  receiveBlock(signedBlock: SignedBeaconBlock, trusted?: boolean): Promise<void>;
}
