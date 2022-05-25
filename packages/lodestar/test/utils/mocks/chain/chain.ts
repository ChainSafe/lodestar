import sinon from "sinon";

import {toHexString} from "@chainsafe/ssz";
import {allForks, UintNum64, Root, Slot, ssz, Uint16, UintBn64} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconStateAllForks, CachedBeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {CheckpointWithHex, IForkChoice, IProtoBlock, ExecutionStatus} from "@chainsafe/lodestar-fork-choice";
import {defaultDefaultFeeRecipient} from "@chainsafe/lodestar-validator";

import {ChainEventEmitter, IBeaconChain} from "../../../../src/chain/index.js";
import {IBeaconClock} from "../../../../src/chain/clock/interface.js";
import {generateEmptySignedBlock} from "../../block.js";
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
import {ExecutionEngineDisabled} from "../../../../src/executionEngine/index.js";
import {ReqRespBlockResponse} from "../../../../src/network/reqresp/types.js";
import {testLogger} from "../../logger.js";
import {ReprocessController} from "../../../../src/chain/reprocess.js";
import {createCachedBeaconStateTest} from "../../../../../beacon-state-transition/test/utils/state.js";
import {SeenAggregatedAttestations} from "../../../../src/chain/seenCache/seenAggregateAndProof.js";
import {BeaconProposerCache} from "../../../../src/chain/beaconProposerCache.js";

/* eslint-disable @typescript-eslint/no-empty-function */

export interface IMockChainParams {
  genesisTime?: UintNum64;
  chainId: Uint16;
  networkId: UintBn64;
  state: BeaconStateAllForks;
  config: IBeaconConfig;
}

export class MockBeaconChain implements IBeaconChain {
  readonly genesisTime: UintNum64;
  readonly genesisValidatorsRoot: Root;
  readonly eth1 = new Eth1ForBlockProductionDisabled();
  readonly executionEngine = new ExecutionEngineDisabled();
  readonly config: IBeaconConfig;
  readonly anchorStateLatestBlockSlot: Slot;

  readonly bls: IBlsVerifier;
  forkChoice: IForkChoice;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  chainId: Uint16;
  networkId: UintBn64;
  clock: IBeaconClock;
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

  readonly beaconProposerCache = new BeaconProposerCache({defaultFeeRecipient: defaultDefaultFeeRecipient});

  private state: BeaconStateAllForks;
  private abortController: AbortController;

  constructor({genesisTime, chainId, networkId, state, config}: IMockChainParams) {
    const logger = testLogger();
    this.genesisTime = genesisTime ?? state.genesisTime;
    this.genesisValidatorsRoot = state.genesisValidatorsRoot;
    this.bls = sinon.createStubInstance(BlsSingleThreadVerifier);
    this.chainId = chainId || 0;
    this.networkId = networkId || BigInt(0);
    this.state = state;
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
    this.lightClientServer = new LightClientServer({
      config: this.config,
      db: db,
      metrics: null,
      emitter: this.emitter,
      logger,
    });
    this.reprocessController = new ReprocessController(null);
  }

  getHeadState(): CachedBeaconStateAllForks {
    return createCachedBeaconStateTest(this.state, this.config);
  }

  async getHeadStateAtCurrentEpoch(): Promise<CachedBeaconStateAllForks> {
    return createCachedBeaconStateTest(this.state, this.config);
  }

  async getCanonicalBlockAtSlot(slot: Slot): Promise<allForks.SignedBeaconBlock> {
    const block = generateEmptySignedBlock();
    block.message.slot = slot;
    return block;
  }

  async getUnfinalizedBlocksAtSlots(slots: Slot[] = []): Promise<ReqRespBlockResponse[]> {
    const blocks = await Promise.all(slots.map(this.getCanonicalBlockAtSlot));
    return blocks.map((block, i) => ({
      slot: slots[i],
      bytes: Buffer.from(ssz.phase0.SignedBeaconBlock.serialize(block)),
    }));
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

  async waitForBlockOfAttestation(): Promise<boolean> {
    return false;
  }

  persistInvalidSszObject(): string | null {
    return null;
  }

  async updateBeaconProposerData(): Promise<void> {}
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

    justifiedEpoch: 0,
    justifiedRoot: rootHex,
    finalizedEpoch: 0,
    finalizedRoot: rootHex,

    ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
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
    validateLatestHash: () => {},
  };
}
