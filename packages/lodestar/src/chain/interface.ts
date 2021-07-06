import {ForkName} from "@chainsafe/lodestar-params";
import {allForks, Number64, Root, phase0, Slot} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {LightClientUpdater} from "@chainsafe/lodestar-light-client/server";

import {IBeaconClock} from "./clock/interface";
import {ChainEventEmitter} from "./emitter";
import {IStateRegenerator} from "./regen";
import {BlockPool} from "./blocks";
import {StateContextCache, CheckpointStateCache} from "./stateCache";
import {IBlsVerifier} from "./bls";
import {SeenAttesters, SeenAggregators} from "./seenCache";
import {IForkDigestContext} from "../util/forkDigestContext";
import {AttestationPool} from "./opsPool/attestationPool";

export interface IProcessBlock {
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

export interface IChainSegmentJob extends IProcessBlock {
  signedBlocks: allForks.SignedBeaconBlock[];
}

export interface IBlockJob extends IProcessBlock {
  signedBlock: allForks.SignedBeaconBlock;
}

/**
 * The IBeaconChain service deals with processing incoming blocks, advancing a state transition
 * and applying the fork choice rule to update the chain head
 */
export interface IBeaconChain {
  readonly genesisTime: Number64;
  readonly genesisValidatorsRoot: Root;

  bls: IBlsVerifier;
  forkChoice: IForkChoice;
  clock: IBeaconClock;
  emitter: ChainEventEmitter;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  regen: IStateRegenerator;
  pendingBlocks: BlockPool;
  forkDigestContext: IForkDigestContext;
  lightclientUpdater: LightClientUpdater;

  // Ops pool
  readonly attestationPool: AttestationPool;

  readonly seenAttesters: SeenAttesters;
  readonly seenAggregators: SeenAggregators;

  /** Stop beacon chain processing */
  close(): void;
  getGenesisTime(): Number64;

  getHeadState(): CachedBeaconState<allForks.BeaconState>;
  getHeadStateAtCurrentEpoch(): Promise<CachedBeaconState<allForks.BeaconState>>;
  getHeadStateAtCurrentSlot(): Promise<CachedBeaconState<allForks.BeaconState>>;
  getHeadBlock(): Promise<allForks.SignedBeaconBlock | null>;

  /**
   * Since we can have multiple parallel chains,
   * this methods returns blocks in current chain head according to
   * forkchoice. Works for finalized slots as well
   * @param slot
   */
  getCanonicalBlockAtSlot(slot: Slot): Promise<allForks.SignedBeaconBlock | null>;
  getStateByBlockRoot(blockRoot: Root): Promise<CachedBeaconState<allForks.BeaconState> | null>;
  getUnfinalizedBlocksAtSlots(slots: Slot[]): Promise<allForks.SignedBeaconBlock[]>;
  getFinalizedCheckpoint(): phase0.Checkpoint;

  /** Pre-process and run the per slot state transition function */
  receiveBlock(signedBlock: allForks.SignedBeaconBlock, trusted?: boolean): void;
  /** Process a block until complete */
  processBlock(
    signedBlock: allForks.SignedBeaconBlock,
    flags: {prefinalized: boolean; trusted: boolean}
  ): Promise<void>;
  /** Process a chain of blocks until complete */
  processChainSegment(
    signedBlocks: allForks.SignedBeaconBlock[],
    flags: {prefinalized: boolean; trusted?: boolean}
  ): Promise<void>;

  /** Get the ForkName from the head state */
  getHeadForkName(): ForkName;
  /** Get the ForkName from the current slot */
  getClockForkName(): ForkName;
  /** Get ForkDigest from the head state */
  getHeadForkDigest(): phase0.ForkDigest;
  /** Get ForkDigest from the current slot */
  getClockForkDigest(): phase0.ForkDigest;

  getStatus(): phase0.Status;
}
