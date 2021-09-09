import {AbortController} from "@chainsafe/abort-controller";
import sinon from "sinon";

import {TreeBacked} from "@chainsafe/ssz";
import {allForks, ForkDigest, Number64, Root, Slot, ssz, Uint16, Uint64} from "@chainsafe/lodestar-types";
import {IBeaconConfig, IChainForkConfig, createIBeaconConfig} from "@chainsafe/lodestar-config";
import {CachedBeaconState, createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {LightClientUpdater} from "@chainsafe/lodestar-light-client/server";

import {ChainEventEmitter, IBeaconChain} from "../../../../src/chain";
import {IBeaconClock} from "../../../../src/chain/clock/interface";
import {generateEmptySignedBlock} from "../../block";
import {CheckpointStateCache, StateContextCache} from "../../../../src/chain/stateCache";
import {LocalClock} from "../../../../src/chain/clock";
import {IStateRegenerator, StateRegenerator} from "../../../../src/chain/regen";
import {StubbedBeaconDb} from "../../stub";
import {BlockPool} from "../../../../src/chain/blocks";
import {IBlsVerifier, BlsSingleThreadVerifier} from "../../../../src/chain/bls";
import {ForkDigestContext, IForkDigestContext} from "../../../../src/util/forkDigestContext";
import {generateEmptyBlockSummary} from "../../block";
import {ForkName} from "@chainsafe/lodestar-params";
import {testLogger} from "../../logger";
import {AttestationPool} from "../../../../src/chain/opPools/attestationPool";
import {
  SeenAggregators,
  SeenAttesters,
  SeenContributionAndProof,
  SeenSyncCommitteeMessages,
} from "../../../../src/chain/seenCache";
import {
  SyncCommitteeMessagePool,
  SyncContributionAndProofPool,
  AggregatedAttestationPool,
} from "../../../../src/chain/opPools";
import {LightClientIniter} from "../../../../src/chain/lightClient";
import {IMetrics} from "../../../../src/metrics";

/* eslint-disable @typescript-eslint/no-empty-function */

export interface IMockChainParams {
  genesisTime?: Number64;
  chainId: Uint16;
  networkId: Uint64;
  state: TreeBacked<allForks.BeaconState>;
  config: IChainForkConfig;
}

export class MockBeaconChain implements IBeaconChain {
  readonly genesisTime: Number64;
  readonly genesisValidatorsRoot: Root;
  readonly bls: IBlsVerifier;
  readonly metrics: IMetrics | null = null;
  readonly config: IBeaconConfig;

  forkChoice: IForkChoice;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  chainId: Uint16;
  networkId: Uint64;
  clock: IBeaconClock;
  regen: IStateRegenerator;
  emitter: ChainEventEmitter;
  pendingBlocks: BlockPool;
  forkDigestContext: IForkDigestContext;
  lightclientUpdater: LightClientUpdater;
  lightClientIniter: LightClientIniter;

  // Ops pool
  readonly attestationPool = new AttestationPool();
  readonly aggregatedAttestationPool = new AggregatedAttestationPool();
  readonly syncCommitteeMessagePool = new SyncCommitteeMessagePool();
  readonly syncContributionAndProofPool = new SyncContributionAndProofPool();

  // Gossip seen cache
  readonly seenAttesters = new SeenAttesters();
  readonly seenAggregators = new SeenAggregators();
  readonly seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
  readonly seenContributionAndProof = new SeenContributionAndProof();

  private state: TreeBacked<allForks.BeaconState>;
  private abortController: AbortController;

  constructor({genesisTime, chainId, networkId, state, config}: IMockChainParams) {
    const logger = testLogger();
    this.genesisTime = genesisTime ?? state.genesisTime;
    this.genesisValidatorsRoot = state.genesisValidatorsRoot;
    this.bls = sinon.createStubInstance(BlsSingleThreadVerifier);
    this.chainId = chainId || 0;
    this.networkId = networkId || BigInt(0);
    this.state = state;
    this.config = createIBeaconConfig(config, state.genesisValidatorsRoot);
    this.emitter = new ChainEventEmitter();
    this.abortController = new AbortController();
    this.clock = new LocalClock({
      config: config,
      genesisTime: genesisTime || state.genesisTime,
      emitter: this.emitter,
      signal: this.abortController.signal,
    });
    this.forkChoice = mockForkChoice();
    this.stateCache = new StateContextCache({});
    this.checkpointStateCache = new CheckpointStateCache({});
    this.pendingBlocks = new BlockPool(config, logger);
    const db = new StubbedBeaconDb(sinon);
    this.regen = new StateRegenerator(this, db);
    this.forkDigestContext = new ForkDigestContext(this.config, this.genesisValidatorsRoot);
    this.lightclientUpdater = new LightClientUpdater(db);
    this.lightClientIniter = new LightClientIniter({
      config: this.config,
      db: db,
      forkChoice: this.forkChoice as ForkChoice,
      stateCache: this.stateCache,
    });
  }

  async getHeadBlock(): Promise<null> {
    return null;
  }

  updateHead(): void {}

  getHeadState(): CachedBeaconState<allForks.BeaconState> {
    return createCachedBeaconState(this.config, this.state);
  }

  async getHeadStateAtCurrentEpoch(): Promise<CachedBeaconState<allForks.BeaconState>> {
    return createCachedBeaconState(this.config, this.state);
  }

  async getHeadStateAtCurrentSlot(): Promise<CachedBeaconState<allForks.BeaconState>> {
    return createCachedBeaconState(this.config, this.state);
  }

  async getCanonicalBlockAtSlot(slot: Slot): Promise<allForks.SignedBeaconBlock> {
    const block = generateEmptySignedBlock();
    block.message.slot = slot;
    return block;
  }

  async getUnfinalizedBlocksAtSlots(slots: Slot[]): Promise<allForks.SignedBeaconBlock[]> {
    if (!slots) {
      return [];
    }
    return await Promise.all(slots.map(this.getCanonicalBlockAtSlot));
  }

  getFinalizedCheckpoint(): phase0.Checkpoint {
    return this.state.finalizedCheckpoint;
  }

  getHeadForkDigest(): ForkDigest {
    return ssz.ForkDigest.defaultValue();
  }
  getClockForkDigest(): ForkDigest {
    return ssz.ForkDigest.defaultValue();
  }
  getHeadForkName(): ForkName {
    return ForkName.phase0;
  }
  getClockForkName(): ForkName {
    return ForkName.phase0;
  }

  getGenesisTime(): Number64 {
    return Math.floor(Date.now() / 1000);
  }

  async receiveBlock(): Promise<void> {}
  async processBlock(): Promise<void> {}
  async processChainSegment(): Promise<void> {}

  close(): void {
    this.abortController.abort();
  }

  async persistToDisk(): Promise<void> {}

  async getStateByBlockRoot(): Promise<CachedBeaconState<allForks.BeaconState> | null> {
    return null;
  }

  getStatus(): phase0.Status {
    return {
      forkDigest: this.getHeadForkDigest(),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 0,
      headRoot: Buffer.alloc(32),
      headSlot: 0,
    };
  }

  persistInvalidSszObject(): string | null {
    return null;
  }
}

function mockForkChoice(): IForkChoice {
  const root = ssz.Root.defaultValue() as Uint8Array;
  const blockSummary = generateEmptyBlockSummary();
  const checkpoint = ssz.phase0.Checkpoint.defaultValue();

  return {
    getAncestor: () => root,
    getHeadRoot: () => root,
    getHead: () => blockSummary,
    updateHead: () => blockSummary,
    getHeads: () => [blockSummary],
    getFinalizedCheckpoint: () => checkpoint,
    getJustifiedCheckpoint: () => checkpoint,
    onBlock: () => {},
    onAttestation: () => {},
    getLatestMessage: () => undefined,
    updateTime: () => {},
    getTime: () => 0,
    hasBlock: () => true,
    getBlock: () => blockSummary,
    getFinalizedBlock: () => blockSummary,
    getJustifiedBlock: () => blockSummary,
    isDescendantOfFinalized: () => true,
    isDescendant: () => true,
    prune: () => [blockSummary],
    setPruneThreshold: () => {},
    iterateBlockSummaries: () => [blockSummary],
    iterateNonAncestors: () => [blockSummary],
    getCanonicalBlockSummaryAtSlot: () => blockSummary,
    forwardIterateBlockSummaries: () => [blockSummary],
    getBlockSummariesByParentRoot: () => [blockSummary],
    getBlockSummariesAtSlot: () => [blockSummary],
  };
}
