import sinon from "sinon";

import {CompositeTypeAny, toHexString, TreeView} from "@chainsafe/ssz";
import {phase0, allForks, UintNum64, Root, Slot, ssz, Uint16, UintBn64, RootHex, deneb, Wei} from "@lodestar/types";
import {BeaconConfig} from "@lodestar/config";
import {BeaconStateAllForks, CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {CheckpointWithHex, IForkChoice, ProtoBlock, ExecutionStatus, AncestorStatus} from "@lodestar/fork-choice";
import {defaultOptions as defaultValidatorOptions} from "@lodestar/validator";
import {Logger} from "@lodestar/utils";

import {ChainEventEmitter, IBeaconChain} from "../../../../src/chain/index.js";
import {BeaconClock} from "../../../../src/chain/clock/interface.js";
import {CheckpointStateCache, StateContextCache} from "../../../../src/chain/stateCache/index.js";
import {LocalClock} from "../../../../src/chain/clock/index.js";
import {IStateRegenerator, StateRegenerator} from "../../../../src/chain/regen/index.js";
import {StubbedBeaconDb} from "../../stub/index.js";
import {IBlsVerifier, BlsSingleThreadVerifier} from "../../../../src/chain/bls/index.js";
import {AttestationPool} from "../../../../src/chain/opPools/attestationPool.js";
import {
  SeenAggregators,
  SeenAttesters,
  SeenBlockProposers,
  SeenContributionAndProof,
  SeenSyncCommitteeMessages,
} from "../../../../src/chain/seenCache/index.js";
import {
  SyncCommitteeMessagePool,
  SyncContributionAndProofPool,
  AggregatedAttestationPool,
  OpPool,
} from "../../../../src/chain/opPools/index.js";
import {LightClientServer} from "../../../../src/chain/lightClient/index.js";
import {Eth1ForBlockProductionDisabled} from "../../../../src/eth1/index.js";
import {ExecutionEngineDisabled} from "../../../../src/execution/engine/index.js";
import {testLogger} from "../../logger.js";
import {ReprocessController} from "../../../../src/chain/reprocess.js";
import {createCachedBeaconStateTest} from "../../../../../state-transition/test/utils/state.js";
import {SeenAggregatedAttestations} from "../../../../src/chain/seenCache/seenAggregateAndProof.js";
import {SeenBlockAttesters} from "../../../../src/chain/seenCache/seenBlockAttesters.js";
import {BeaconProposerCache} from "../../../../src/chain/beaconProposerCache.js";
import {CheckpointBalancesCache} from "../../../../src/chain/balancesCache.js";
import {IChainOptions} from "../../../../src/chain/options.js";
import {BlockAttributes} from "../../../../src/chain/produceBlock/produceBlockBody.js";
import {ReqRespBlockResponse} from "../../../../src/network/index.js";

/* eslint-disable @typescript-eslint/no-empty-function */

export type MockChainParams = {
  genesisTime?: UintNum64;
  chainId: Uint16;
  networkId: UintBn64;
  state: BeaconStateAllForks;
  config: BeaconConfig;
};

export class MockBeaconChain implements IBeaconChain {
  readonly genesisTime: UintNum64;
  readonly genesisValidatorsRoot: Root;
  readonly eth1 = new Eth1ForBlockProductionDisabled();
  readonly executionEngine = new ExecutionEngineDisabled();
  readonly config: BeaconConfig;
  readonly logger: Logger;
  readonly metrics = null;
  readonly opts: IChainOptions = {
    persistInvalidSszObjectsDir: "",
    proposerBoostEnabled: false,
    safeSlotsToImportOptimistically: 0,
    suggestedFeeRecipient: "0x0000000000000000000000000000000000000000",
    archiveStateEpochFrequency: 1024,
  };
  readonly anchorStateLatestBlockSlot: Slot;

  readonly bls: IBlsVerifier;
  forkChoice: IForkChoice;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  chainId: Uint16;
  networkId: UintBn64;
  clock: BeaconClock;
  regen: IStateRegenerator;
  emitter: ChainEventEmitter;
  lightClientServer: LightClientServer;
  reprocessController: ReprocessController;

  // Ops pool
  readonly attestationPool = new AttestationPool();
  readonly aggregatedAttestationPool = new AggregatedAttestationPool();
  readonly syncCommitteeMessagePool = new SyncCommitteeMessagePool();
  readonly syncContributionAndProofPool = new SyncContributionAndProofPool();
  readonly opPool = new OpPool();

  // Gossip seen cache
  readonly seenAttesters = new SeenAttesters();
  readonly seenAggregators = new SeenAggregators();
  readonly seenAggregatedAttestations = new SeenAggregatedAttestations(null);
  readonly seenBlockProposers = new SeenBlockProposers();
  readonly seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
  readonly seenContributionAndProof = new SeenContributionAndProof(null);
  readonly seenBlockAttesters = new SeenBlockAttesters();

  readonly beaconProposerCache = new BeaconProposerCache({
    suggestedFeeRecipient: defaultValidatorOptions.suggestedFeeRecipient,
  });
  readonly checkpointBalancesCache = new CheckpointBalancesCache();

  private readonly state: CachedBeaconStateAllForks;
  private abortController: AbortController;

  readonly producedBlobsSidecarCache = new Map<RootHex, deneb.BlobsSidecar>();

  constructor({genesisTime, chainId, networkId, state, config}: MockChainParams) {
    this.logger = testLogger();
    this.genesisTime = genesisTime ?? state.genesisTime;
    this.genesisValidatorsRoot = state.genesisValidatorsRoot;
    this.bls = sinon.createStubInstance(BlsSingleThreadVerifier);
    this.chainId = chainId || 0;
    this.networkId = networkId || BigInt(0);
    this.state = createCachedBeaconStateTest(state, config);
    this.anchorStateLatestBlockSlot = state.latestBlockHeader.slot;
    this.config = config;
    this.emitter = new ChainEventEmitter();
    this.abortController = new AbortController();
    this.clock = new LocalClock({
      config: config,
      genesisTime: genesisTime === undefined || genesisTime === 0 ? state.genesisTime : genesisTime,
      emitter: this.emitter,
      signal: this.abortController.signal,
    });
    this.forkChoice = mockForkChoice();
    this.stateCache = new StateContextCache({});
    this.checkpointStateCache = new CheckpointStateCache({});
    const db = new StubbedBeaconDb();
    this.regen = new StateRegenerator({
      config: this.config,
      forkChoice: this.forkChoice,
      stateCache: this.stateCache,
      checkpointStateCache: this.checkpointStateCache,
      db,
      metrics: null,
      emitter: this.emitter,
    });
    this.lightClientServer = new LightClientServer(
      {},
      {
        config: this.config,
        db,
        metrics: null,
        emitter: this.emitter,
        logger: this.logger,
      }
    );
    this.reprocessController = new ReprocessController(null);
  }

  validatorSeenAtEpoch(): boolean {
    return false;
  }

  persistInvalidSszView(_: TreeView<CompositeTypeAny>): void {}

  getHeadState(): CachedBeaconStateAllForks {
    return this.state;
  }

  async getHeadStateAtCurrentEpoch(): Promise<CachedBeaconStateAllForks> {
    return this.state;
  }

  async getCanonicalBlockAtSlot(): Promise<allForks.SignedBeaconBlock> {
    throw Error("Not implemented");
  }

  async getUnfinalizedBlocksAtSlots(): Promise<ReqRespBlockResponse[]> {
    throw Error("Not implemented");
  }

  async produceBlock(_blockAttributes: BlockAttributes): Promise<{block: allForks.BeaconBlock; blockValue: Wei}> {
    throw Error("Not implemented");
  }
  async produceBlindedBlock(
    _blockAttributes: BlockAttributes
  ): Promise<{block: allForks.BlindedBeaconBlock; blockValue: Wei}> {
    throw Error("Not implemented");
  }

  getBlobsSidecar(): never {
    throw Error("Not implemented");
  }

  async processBlock(): Promise<void> {}
  async processChainSegment(): Promise<void> {}

  async close(): Promise<void> {
    this.abortController.abort();
  }

  async persistToDisk(): Promise<void> {}
  async loadFromDisk(): Promise<void> {}

  getStatus(): phase0.Status {
    return {
      forkDigest: Buffer.alloc(4),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 0,
      headRoot: Buffer.alloc(32),
      headSlot: 0,
    };
  }

  recomputeForkChoiceHead(): ProtoBlock {
    return this.forkChoice.getHead();
  }

  async waitForBlock(): Promise<boolean> {
    return false;
  }

  persistInvalidSszObject(): void {
    return;
  }

  persistInvalidSszValue(): void {
    return;
  }

  async updateBeaconProposerData(): Promise<void> {}
  updateBuilderStatus(): void {}
}

const root = ssz.Root.defaultValue() as Uint8Array;
const rootHex = toHexString(root);
export const zeroProtoBlock: ProtoBlock = {
  slot: 0,
  blockRoot: rootHex,
  parentRoot: rootHex,
  stateRoot: rootHex,
  targetRoot: rootHex,

  justifiedEpoch: 0,
  justifiedRoot: rootHex,
  finalizedEpoch: 0,
  finalizedRoot: rootHex,
  unrealizedJustifiedEpoch: 0,
  unrealizedJustifiedRoot: rootHex,
  unrealizedFinalizedEpoch: 0,
  unrealizedFinalizedRoot: rootHex,

  ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
};

function mockForkChoice(): IForkChoice {
  const root = ssz.Root.defaultValue() as Uint8Array;
  const rootHex = toHexString(root);
  const block: ProtoBlock = zeroProtoBlock;
  const checkpoint: CheckpointWithHex = {epoch: 0, root, rootHex};

  return {
    irrecoverableError: undefined,
    getAncestor: () => rootHex,
    getHeadRoot: () => rootHex,
    getHead: () => block,
    updateHead: () => block,
    getHeads: () => [block],
    getAllNodes: () => [{...block, weight: 1}],
    getFinalizedCheckpoint: () => checkpoint,
    getJustifiedCheckpoint: () => checkpoint,
    onBlock: () => block,
    onAttestation: () => {},
    onAttesterSlashing: () => {},
    getLatestMessage: () => undefined,
    updateTime: () => {},
    getTime: () => 0,
    hasBlock: () => true,
    hasBlockHex: () => true,
    getSlotsPresent: () => 0,
    getBlock: () => block,
    getBlockHex: () => block,
    getFinalizedBlock: () => block,
    getJustifiedBlock: () => block,
    isDescendantOfFinalized: () => true,
    isDescendant: () => true,
    prune: () => [block],
    setPruneThreshold: () => {},
    iterateAncestorBlocks: emptyGenerator,
    getAllAncestorBlocks: () => [block],
    getAllNonAncestorBlocks: () => [block],
    getCanonicalBlockAtSlot: () => block,
    forwarditerateAncestorBlocks: () => [block],
    forwardIterateDescendants: emptyGenerator,
    getBlockSummariesByParentRoot: () => [block],
    getBlockSummariesAtSlot: () => [block],
    getCommonAncestorDepth: () => ({code: AncestorStatus.NoCommonAncenstor}),
    validateLatestHash: () => {},
    getDependentRoot: () => rootHex,
  };
}

function* emptyGenerator<T>(): IterableIterator<T> {}
