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
import {
  SeenAttesters,
  SeenAggregators,
  SeenBlockProposers,
  SeenSyncCommitteeMessages,
  SeenContributionAndProof,
} from "./seenCache";
import {AttestationPool, OpPool, SyncCommitteeMessagePool, SyncContributionAndProofPool} from "./opPools";
import {IForkDigestContext} from "../util/forkDigestContext";
import {LightClientIniter} from "./lightClient";
import {AggregatedAttestationPool} from "./opPools/aggregatedAttestationPool";

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
  lightClientIniter: LightClientIniter;

  // Ops pool
  readonly attestationPool: AttestationPool;
  readonly aggregatedAttestationPool: AggregatedAttestationPool;
  readonly syncCommitteeMessagePool: SyncCommitteeMessagePool;
  readonly syncContributionAndProofPool: SyncContributionAndProofPool;
  readonly opPool: OpPool;

  // Gossip seen cache
  readonly seenAttesters: SeenAttesters;
  readonly seenAggregators: SeenAggregators;
  readonly seenBlockProposers: SeenBlockProposers;
  readonly seenSyncCommitteeMessages: SeenSyncCommitteeMessages;
  readonly seenContributionAndProof: SeenContributionAndProof;

  /** Stop beacon chain processing */
  close(): void;
  /** Populate in-memory caches with persisted data. Call at least once on startup */
  loadFromDisk(): Promise<void>;
  /** Persist in-memory data to the DB. Call at least once before stopping the process */
  persistToDisk(): Promise<void>;
  getGenesisTime(): Number64;

  getHeadState(): CachedBeaconState<allForks.BeaconState>;
  getHeadStateAtCurrentEpoch(): Promise<CachedBeaconState<allForks.BeaconState>>;

  /**
   * Since we can have multiple parallel chains,
   * this methods returns blocks in current chain head according to
   * forkchoice. Works for finalized slots as well
   * @param slot
   */
  getCanonicalBlockAtSlot(slot: Slot): Promise<allForks.SignedBeaconBlock | null>;
  getUnfinalizedBlocksAtSlots(slots: Slot[]): Promise<allForks.SignedBeaconBlock[]>;

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

  /** Persist bad items to persistInvalidSszObjectsDir dir, for example invalid state, attestations etc. */
  persistInvalidSszObject(type: SSZObjectType, bytes: Uint8Array, suffix: string): string | null;
}

export type SSZObjectType =
  | "state"
  | "signedBlock"
  | "block"
  | "attestation"
  | "signedAggregatedAndProof"
  | "syncCommittee"
  | "contributionAndProof";
