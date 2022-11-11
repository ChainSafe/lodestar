import {allForks, UintNum64, Root, phase0, Slot, RootHex, Epoch, ValidatorIndex} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {IBeaconConfig} from "@lodestar/config";
import {CompositeTypeAny, TreeView, Type} from "@chainsafe/ssz";
import {ILogger} from "@lodestar/utils";

import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {SeenAggregatedAttestations} from "@lodestar/beacon-node/chain/seenCache/seenAggregateAndProof";
import {CheckpointStateCache, ProposerPreparationData, StateContextCache} from "@lodestar/beacon-node/chain";
import {
  SeenAggregators,
  SeenAttesters,
  SeenBlockProposers,
  SeenContributionAndProof,
  SeenSyncCommitteeMessages,
} from "@lodestar/beacon-node/chain/seenCache";
import {
  AggregatedAttestationPool,
  AttestationPool,
  OpPool,
  SyncCommitteeMessagePool,
  SyncContributionAndProofPool,
} from "@lodestar/beacon-node/chain/opPools";
import {SeenBlockAttesters} from "@lodestar/beacon-node/chain/seenCache/seenBlockAttesters";
import {BeaconProposerCache} from "@lodestar/beacon-node/chain/beaconProposerCache";
import {CheckpointBalancesCache} from "@lodestar/beacon-node/chain/balancesCache";
import {ReprocessController} from "@lodestar/beacon-node/chain/reprocess";
import {IEth1ForBlockProduction} from "@lodestar/beacon-node/eth1";
import {IExecutionBuilder, IExecutionEngine} from "@lodestar/beacon-node/execution";
import {IBeaconClock} from "./clock/interface.js";
import {ChainEventEmitter} from "./emitter.js";
import {IStateRegenerator} from "./regen/index.js";
import {IBlsVerifier} from "./bls/index.js";
import {LightClientServer} from "./lightClient/index.js";
import {ImportBlockOpts} from "./blocks/types.js";
import {IChainOptions} from "./options.js";
import {AssembledBlockType, BlockAttributes, BlockType} from "./produceBlock/produceBlockBody.js";

export {BlockType, AssembledBlockType};
export {ProposerPreparationData};

/**
 * The IBeaconChain service deals with processing incoming blocks, advancing a state transition
 * and applying the fork choice rule to update the chain head
 */
export interface IBeaconChain {
  readonly genesisTime: UintNum64;
  readonly genesisValidatorsRoot: Root;
  readonly eth1: IEth1ForBlockProduction;
  readonly executionEngine: IExecutionEngine;
  readonly executionBuilder?: IExecutionBuilder;
  // Expose config for convenience in modularized functions
  readonly config: IBeaconConfig;
  readonly logger: ILogger;

  /** The initial slot that the chain is started with */
  readonly anchorStateLatestBlockSlot: Slot;

  readonly bls: IBlsVerifier;
  readonly forkChoice: IForkChoice;
  readonly clock: IBeaconClock;
  readonly emitter: ChainEventEmitter;
  readonly stateCache: StateContextCache;
  readonly checkpointStateCache: CheckpointStateCache;
  readonly regen: IStateRegenerator;
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
  readonly seenAggregatedAttestations: SeenAggregatedAttestations;
  readonly seenBlockProposers: SeenBlockProposers;
  readonly seenSyncCommitteeMessages: SeenSyncCommitteeMessages;
  readonly seenContributionAndProof: SeenContributionAndProof;
  // Seen cache for liveness checks
  readonly seenBlockAttesters: SeenBlockAttesters;

  readonly beaconProposerCache: BeaconProposerCache;
  readonly checkpointBalancesCache: CheckpointBalancesCache;
  readonly opts: IChainOptions;

  /** Stop beacon chain processing */
  close(): Promise<void>;
  /** Populate in-memory caches with persisted data. Call at least once on startup */
  loadFromDisk(): Promise<void>;
  /** Persist in-memory data to the DB. Call at least once before stopping the process */
  persistToDisk(): Promise<void>;

  validatorSeenAtEpoch(index: ValidatorIndex, epoch: Epoch): boolean;

  getHeadState(): CachedBeaconStateAllForks;
  getHeadStateAtCurrentEpoch(): Promise<CachedBeaconStateAllForks>;

  /**
   * Since we can have multiple parallel chains,
   * this methods returns blocks in current chain head according to
   * forkchoice. Works for finalized slots as well
   * @param slot
   */
  getCanonicalBlockAtSlot(slot: Slot): Promise<allForks.SignedBeaconBlock | null>;

  produceBlock(blockAttributes: BlockAttributes): Promise<allForks.BeaconBlock>;
  produceBlindedBlock(blockAttributes: BlockAttributes): Promise<allForks.BlindedBeaconBlock>;

  /** Process a block until complete */
  processBlock(block: allForks.SignedBeaconBlock, opts?: ImportBlockOpts): Promise<void>;
  /** Process a chain of blocks until complete */
  processChainSegment(blocks: allForks.SignedBeaconBlock[], opts?: ImportBlockOpts): Promise<void>;

  getStatus(): phase0.Status;

  recomputeForkChoiceHead(): ProtoBlock;

  waitForBlockOfAttestation(slot: Slot, root: RootHex): Promise<boolean>;

  updateBeaconProposerData(epoch: Epoch, proposers: ProposerPreparationData[]): Promise<void>;

  persistInvalidSszValue<T>(type: Type<T>, sszObject: T | Uint8Array, suffix?: string): void;
  /** Persist bad items to persistInvalidSszObjectsDir dir, for example invalid state, attestations etc. */
  persistInvalidSszView(view: TreeView<CompositeTypeAny>, suffix?: string): void;
  updateBuilderStatus(clockSlot: Slot): void;
}

export type SSZObjectType =
  | "state"
  | "signedBlock"
  | "block"
  | "attestation"
  | "signedAggregatedAndProof"
  | "syncCommittee"
  | "contributionAndProof";
