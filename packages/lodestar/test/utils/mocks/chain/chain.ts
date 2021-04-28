import {AbortController} from "abort-controller";
import sinon from "sinon";

import {byteArrayEquals, toHexString, TreeBacked} from "@chainsafe/ssz";
import {allForks, ForkDigest, Number64, Root, Slot, Uint16, Uint64} from "@chainsafe/lodestar-types";
import {IBeaconConfig, ForkName} from "@chainsafe/lodestar-config";
import {
  CachedBeaconState,
  computeForkDigest,
  createCachedBeaconState,
} from "@chainsafe/lodestar-beacon-state-transition";
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
  forkChoice!: IForkChoice;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  chainId: Uint16;
  networkId: Uint64;
  clock: IBeaconClock;
  regen: IStateRegenerator;
  emitter: ChainEventEmitter;
  pendingBlocks: BlockPool;
  pendingAttestations: AttestationPool;

  private state: TreeBacked<allForks.BeaconState>;
  private config: IBeaconConfig;
  private abortController: AbortController;
  private forkDigestCache: Map<ForkName, ForkDigest> = new Map<ForkName, ForkDigest>();

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
    });
    const fork = Object.values(this.config.getForkInfoRecord())[0];
    this.forkDigestCache.set(fork.name, computeForkDigest(this.config, fork.version, this.genesisValidatorsRoot));
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
    return Array.from(this.forkDigestCache.values())[0];
  }

  getClockForkDigest(): ForkDigest {
    return this.getHeadForkDigest();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getForkDigest(_: ForkName): ForkDigest {
    return this.getHeadForkDigest();
  }

  getHeadForkName(): ForkName {
    return Array.from(this.forkDigestCache.keys())[0];
  }

  getClockForkName(): ForkName {
    return this.getHeadForkName();
  }

  getForkName(forkDigest: ForkDigest): ForkName {
    if (!byteArrayEquals(forkDigest as Uint8Array, this.getHeadForkDigest() as Uint8Array)) {
      throw new Error("Invalid fork digest " + toHexString(forkDigest));
    }
    return this.getHeadForkName();
  }

  getENRForkID(): phase0.ENRForkID {
    return {
      forkDigest: Buffer.alloc(4),
      nextForkEpoch: 100,
      nextForkVersion: Buffer.alloc(4),
    };
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
    return;
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
