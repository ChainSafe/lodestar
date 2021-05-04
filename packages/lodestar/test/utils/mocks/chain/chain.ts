import {AbortController} from "abort-controller";
import sinon from "sinon";

import {TreeBacked} from "@chainsafe/ssz";
import {allForks, ForkDigest, Number64, Root, Slot, Uint16, Uint64} from "@chainsafe/lodestar-types";
import {IBeaconConfig, ForkName} from "@chainsafe/lodestar-config";
import {CachedBeaconState, createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ChainEventEmitter, IBeaconChain} from "../../../../src/chain";
import {IBeaconClock} from "../../../../src/chain/clock/interface";
import {generateEmptySignedBlock} from "../../block";
import {CheckpointStateCache, StateContextCache} from "../../../../src/chain/stateCache";
import {LocalClock} from "../../../../src/chain/clock";
import {IStateRegenerator, StateRegenerator} from "../../../../src/chain/regen";
import {StubbedBeaconDb} from "../../stub";
import {BlockPool} from "../../../../src/chain/blocks";
import {AttestationPool} from "../../../../src/chain/attestation";
import {BlsVerifier, IBlsVerifier} from "../../../../src/chain/bls";
import {ForkDigestContext, IForkDigestContext} from "../../../../src/util/forkDigestContext";
import {generateEmptyBlockSummary} from "../../block";

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
  readonly bls: IBlsVerifier;
  forkChoice: IForkChoice;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  chainId: Uint16;
  networkId: Uint64;
  clock: IBeaconClock;
  regen: IStateRegenerator;
  emitter: ChainEventEmitter;
  pendingBlocks: BlockPool;
  pendingAttestations: AttestationPool;
  forkDigestContext: IForkDigestContext;

  private state: TreeBacked<allForks.BeaconState>;
  private config: IBeaconConfig;
  private abortController: AbortController;

  constructor({genesisTime, chainId, networkId, state, config}: IMockChainParams) {
    this.genesisTime = genesisTime ?? state.genesisTime;
    this.genesisValidatorsRoot = state.genesisValidatorsRoot;
    this.bls = sinon.createStubInstance(BlsVerifier);
    this.chainId = chainId || 0;
    this.networkId = networkId || BigInt(0);
    this.state = state;
    this.config = config;
    this.emitter = new ChainEventEmitter();
    this.abortController = new AbortController();
    this.clock = new LocalClock({
      config: config,
      genesisTime: genesisTime || state.genesisTime,
      emitter: this.emitter,
      signal: this.abortController.signal,
    });
    this.forkChoice = mockForkChoice(config);
    this.stateCache = new StateContextCache();
    this.checkpointStateCache = new CheckpointStateCache(this.config);
    this.pendingBlocks = new BlockPool({
      config: this.config,
    });
    this.pendingAttestations = new AttestationPool({
      config: this.config,
    });
    this.regen = new StateRegenerator({
      config: this.config,
      emitter: this.emitter,
      forkChoice: this.forkChoice,
      stateCache: this.stateCache,
      checkpointStateCache: this.checkpointStateCache,
      db: new StubbedBeaconDb(sinon),
      metrics: null,
    });
    this.forkDigestContext = new ForkDigestContext(this.config, this.genesisValidatorsRoot);
  }

  async getHeadBlock(): Promise<null> {
    return null;
  }

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
    return this.config.types.ForkDigest.defaultValue();
  }
  getClockForkDigest(): ForkDigest {
    return this.config.types.ForkDigest.defaultValue();
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

  async receiveAttestation(): Promise<void> {
    return;
  }

  async receiveBlock(): Promise<void> {
    return;
  }

  async processChainSegment(): Promise<void> {
    return;
  }

  close(): void {
    this.abortController.abort();
  }

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
}

function mockForkChoice(config: IBeaconConfig): IForkChoice {
  const root = config.types.Root.defaultValue() as Uint8Array;
  const blockSummary = generateEmptyBlockSummary();
  const checkpoint = config.types.phase0.Checkpoint.defaultValue();

  return {
    getAncestor: () => root,
    getHeadRoot: () => root,
    getHead: () => blockSummary,
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
