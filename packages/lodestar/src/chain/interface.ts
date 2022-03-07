import {allForks, Number64, Root, phase0, Slot, RootHex} from "@chainsafe/lodestar-types";
import {CachedBeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IEth1ForBlockProduction} from "../eth1";
import {IExecutionEngine} from "../executionEngine";
import {IBeaconClock} from "./clock/interface";
import {ChainEventEmitter} from "./emitter";
import {IStateRegenerator} from "./regen";
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
import {LightClientServer} from "./lightClient";
import {AggregatedAttestationPool} from "./opPools/aggregatedAttestationPool";
import {PartiallyVerifiedBlockFlags} from "./blocks/types";
import {ReprocessController} from "./reprocess";

export type Eth2Context = {
  activeValidatorCount: number;
  currentSlot: number;
  currentEpoch: number;
};

/**
 * The IBeaconChain service deals with processing incoming blocks, advancing a state transition
 * and applying the fork choice rule to update the chain head
 */
export interface IBeaconChain {
  readonly genesisTime: Number64;
  readonly genesisValidatorsRoot: Root;
  readonly eth1: IEth1ForBlockProduction;
  readonly executionEngine: IExecutionEngine;
  // Expose config for convenience in modularized functions
  readonly config: IBeaconConfig;

  /** The initial slot that the chain is started with */
  readonly anchorStateLatestBlockSlot: Slot;

  bls: IBlsVerifier;
  forkChoice: IForkChoice;
  clock: IBeaconClock;
  emitter: ChainEventEmitter;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  regen: IStateRegenerator;
  readonly lightClientServer: LightClientServer;
  readonly reprocessController: ReprocessController;

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

  getHeadState(): CachedBeaconStateAllForks;
  getHeadStateAtCurrentEpoch(): Promise<CachedBeaconStateAllForks>;

  /**
   * Since we can have multiple parallel chains,
   * this methods returns blocks in current chain head according to
   * forkchoice. Works for finalized slots as well
   * @param slot
   */
  getCanonicalBlockAtSlot(slot: Slot): Promise<allForks.SignedBeaconBlock | null>;

  /** Process a block until complete */
  processBlock(signedBlock: allForks.SignedBeaconBlock, flags?: PartiallyVerifiedBlockFlags): Promise<void>;
  /** Process a chain of blocks until complete */
  processChainSegment(signedBlocks: allForks.SignedBeaconBlock[], flags?: PartiallyVerifiedBlockFlags): Promise<void>;

  getStatus(): phase0.Status;

  waitForBlockOfAttestation(slot: Slot, root: RootHex): Promise<boolean>;

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
