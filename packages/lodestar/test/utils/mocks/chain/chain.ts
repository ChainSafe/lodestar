import {AbortController} from "@chainsafe/abort-controller";
import sinon from "sinon";

import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {allForks, Number64, Root, Slot, ssz, Uint16, Uint64} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {CachedBeaconState, createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {CheckpointWithHex, ForkChoice, IForkChoice, IProtoBlock} from "@chainsafe/lodestar-fork-choice";
import {LightClientUpdater} from "@chainsafe/lodestar-light-client/server";

import {ChainEventEmitter, IBeaconChain} from "../../../../src/chain";
import {IBeaconClock} from "../../../../src/chain/clock/interface";
import {generateEmptySignedBlock} from "../../block";
import {CheckpointStateCache, StateContextCache} from "../../../../src/chain/stateCache";
import {LocalClock} from "../../../../src/chain/clock";
import {IStateRegenerator, QueuedStateRegenerator} from "../../../../src/chain/regen";
import {StubbedBeaconDb} from "../../stub";
import {IBlsVerifier, BlsSingleThreadVerifier} from "../../../../src/chain/bls";
import {AttestationPool} from "../../../../src/chain/opPools/attestationPool";
import {
  SeenAggregators,
  SeenAttesters,
  SeenBlockProposers,
  SeenContributionAndProof,
  SeenSyncCommitteeMessages,
} from "../../../../src/chain/seenCache";
import {
  SyncCommitteeMessagePool,
  SyncContributionAndProofPool,
  AggregatedAttestationPool,
  OpPool,
} from "../../../../src/chain/opPools";
import {LightClientIniter} from "../../../../src/chain/lightClient";
import {Eth1ForBlockProductionDisabled} from "../../../../src/eth1";
import {ExecutionEngineDisabled} from "../../../../src/executionEngine";

/* eslint-disable @typescript-eslint/no-empty-function */

export interface IMockChainParams {
  genesisTime?: Number64;
  chainId: Uint16;
  networkId: Uint64;
  state: TreeBacked<allForks.BeaconState>;
  config: IBeaconConfig;
}

export class MockBeaconChain implements IBeaconChain {
  readonly genesisTime: Number64;
  readonly genesisValidatorsRoot: Root;
  readonly eth1 = new Eth1ForBlockProductionDisabled();
  readonly executionEngine = new ExecutionEngineDisabled();
  readonly config: IBeaconConfig;

  readonly bls: IBlsVerifier;
  forkChoice: IForkChoice;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  chainId: Uint16;
  networkId: Uint64;
  clock: IBeaconClock;
  regen: IStateRegenerator;
  emitter: ChainEventEmitter;
  lightclientUpdater: LightClientUpdater;
  lightClientIniter: LightClientIniter;

  // Ops pool
  readonly attestationPool = new AttestationPool();
  readonly aggregatedAttestationPool = new AggregatedAttestationPool();
  readonly syncCommitteeMessagePool = new SyncCommitteeMessagePool();
  readonly syncContributionAndProofPool = new SyncContributionAndProofPool();
  readonly opPool = new OpPool();

  // Gossip seen cache
  readonly seenAttesters = new SeenAttesters();
  readonly seenAggregators = new SeenAggregators();
  readonly seenBlockProposers = new SeenBlockProposers();
  readonly seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
  readonly seenContributionAndProof = new SeenContributionAndProof();

  private state: TreeBacked<allForks.BeaconState>;
  private abortController: AbortController;

  constructor({genesisTime, chainId, networkId, state, config}: IMockChainParams) {
    this.genesisTime = genesisTime ?? state.genesisTime;
    this.genesisValidatorsRoot = state.genesisValidatorsRoot;
    this.bls = sinon.createStubInstance(BlsSingleThreadVerifier);
    this.chainId = chainId || 0;
    this.networkId = networkId || BigInt(0);
    this.state = state;
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
    this.regen = new QueuedStateRegenerator({
      config: this.config,
      forkChoice: this.forkChoice,
      stateCache: this.stateCache,
      checkpointStateCache: this.checkpointStateCache,
      db,
      metrics: null,
      signal: this.abortController.signal,
    });
    this.lightclientUpdater = new LightClientUpdater(db);
    this.lightClientIniter = new LightClientIniter({
      config: this.config,
      db: db,
      forkChoice: this.forkChoice as ForkChoice,
      stateCache: this.stateCache,
    });
  }

  getHeadState(): CachedBeaconState<allForks.BeaconState> {
    return createCachedBeaconState(this.config, this.state);
  }

  async getHeadStateAtCurrentEpoch(): Promise<CachedBeaconState<allForks.BeaconState>> {
    return createCachedBeaconState(this.config, this.state);
  }

  async getCanonicalBlockAtSlot(slot: Slot): Promise<allForks.SignedBeaconBlock> {
    const block = generateEmptySignedBlock();
    block.message.slot = slot;
    return block;
  }

  async getUnfinalizedBlocksAtSlots(slots: Slot[] = []): Promise<allForks.SignedBeaconBlock[]> {
    return await Promise.all(slots.map(this.getCanonicalBlockAtSlot));
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

  persistInvalidSszObject(): string | null {
    return null;
  }
}

function mockForkChoice(): IForkChoice {
  const root = ssz.Root.defaultValue() as Uint8Array;
  const rootHex = toHexString(root);
  const block: IProtoBlock = {
    slot: 0,
    blockRoot: rootHex,
    parentRoot: rootHex,
    stateRoot: rootHex,
    targetRoot: rootHex,
    executionPayloadBlockHash: null,
    justifiedEpoch: 0,
    justifiedRoot: rootHex,
    finalizedEpoch: 0,
    finalizedRoot: rootHex,
  };
  const checkpoint: CheckpointWithHex = {epoch: 0, root, rootHex};

  return {
    getAncestor: () => rootHex,
    getHeadRoot: () => rootHex,
    getHead: () => block,
    updateHead: () => block,
    getHeads: () => [block],
    getFinalizedCheckpoint: () => checkpoint,
    getJustifiedCheckpoint: () => checkpoint,
    onBlock: () => {},
    onAttestation: () => {},
    getLatestMessage: () => undefined,
    updateTime: () => {},
    getTime: () => 0,
    hasBlock: () => true,
    hasBlockHex: () => true,
    getBlock: () => block,
    getBlockHex: () => block,
    getFinalizedBlock: () => block,
    getJustifiedBlock: () => block,
    isDescendantOfFinalized: () => true,
    isDescendant: () => true,
    prune: () => [block],
    setPruneThreshold: () => {},
    iterateAncestorBlocks: function* () {
      yield block;
    },
    getAllAncestorBlocks: () => [block],
    getAllNonAncestorBlocks: () => [block],
    getCanonicalBlockAtSlot: () => block,
    forwarditerateAncestorBlocks: () => [block],
    getBlockSummariesByParentRoot: () => [block],
    getBlockSummariesAtSlot: () => [block],
    getCommonAncestorDistance: () => null,
  };
}
