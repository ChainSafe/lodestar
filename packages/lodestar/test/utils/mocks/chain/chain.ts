import {AbortController} from "abort-controller";
import sinon from "sinon";

import {TreeBacked} from "@chainsafe/ssz";
import {
  BeaconState,
  Checkpoint,
  ENRForkID,
  ForkDigest,
  Number64,
  SignedBeaconBlock,
  Slot,
  Uint16,
  Uint64,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeForkDigest, EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ChainEventEmitter, IBeaconChain, ITreeStateContext} from "../../../../src/chain";
import {IBeaconClock} from "../../../../src/chain/clock/interface";
import {generateEmptySignedBlock} from "../../block";
import {StateContextCache} from "../../../../src/chain/stateContextCache";
import {CheckpointStateCache} from "../../../../src/chain/stateContextCheckpointsCache";
import {LocalClock} from "../../../../src/chain/clock";
import {IStateRegenerator, StateRegenerator} from "../../../../src/chain/regen";
import {StubbedBeaconDb} from "../../stub";
import {BlockPool} from "../../../../src/chain/blocks";
import {AttestationPool} from "../../../../src/chain/attestation";
import {createCachedValidatorsBeaconState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";

export interface IMockChainParams {
  genesisTime: Number64;
  chainId: Uint16;
  networkId: Uint64;
  state: TreeBacked<BeaconState>;
  config: IBeaconConfig;
}

export class MockBeaconChain implements IBeaconChain {
  public forkChoice!: IForkChoice;
  public stateCache: StateContextCache;
  public checkpointStateCache: CheckpointStateCache;
  public chainId: Uint16;
  public networkId: Uint64;
  public clock!: IBeaconClock;
  public regen: IStateRegenerator;
  public emitter: ChainEventEmitter;
  public pendingBlocks: BlockPool;
  public pendingAttestations: AttestationPool;

  private state: TreeBacked<BeaconState> | null;
  private config: IBeaconConfig;
  private abortController: AbortController;

  public constructor({chainId, networkId, state, config}: Partial<IMockChainParams>) {
    this.chainId = chainId || 0;
    this.networkId = networkId || BigInt(0);
    this.state = state!;
    this.config = config!;
    this.emitter = new ChainEventEmitter();
    this.abortController = new AbortController();
    this.clock = new LocalClock({
      config: config!,
      genesisTime: state!.genesisTime,
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
  }

  async getHeadBlock(): Promise<null> {
    return null;
  }

  public async getHeadStateContext(): Promise<ITreeStateContext> {
    return {
      state: createCachedValidatorsBeaconState(this.state!),
      epochCtx: new EpochContext(this.config),
    };
  }

  public async getHeadStateContextAtCurrentEpoch(): Promise<ITreeStateContext> {
    return {
      state: createCachedValidatorsBeaconState(this.state!),
      epochCtx: new EpochContext(this.config),
    };
  }

  public async getHeadStateContextAtCurrentSlot(): Promise<ITreeStateContext> {
    return {
      state: createCachedValidatorsBeaconState(this.state!),
      epochCtx: new EpochContext(this.config),
    };
  }

  public async getCanonicalBlockAtSlot(slot: Slot): Promise<SignedBeaconBlock> {
    const block = generateEmptySignedBlock();
    block.message.slot = slot;
    return block;
  }

  public async getHeadEpochContext(): Promise<EpochContext> {
    return (await this.getHeadStateContext()).epochCtx;
  }

  public async getHeadState(): Promise<TreeBacked<BeaconState>> {
    return (await this.getHeadStateContext()).state.getOriginalState() as TreeBacked<BeaconState>;
  }

  public async getUnfinalizedBlocksAtSlots(slots: Slot[]): Promise<SignedBeaconBlock[] | null> {
    if (!slots) {
      return [];
    }
    return await Promise.all(slots.map(this.getCanonicalBlockAtSlot));
  }

  public async getFinalizedCheckpoint(): Promise<Checkpoint> {
    return this.state!.finalizedCheckpoint;
  }

  public async getForkDigest(): Promise<ForkDigest> {
    return computeForkDigest(this.config, this.state!.fork.currentVersion, this.state!.genesisValidatorsRoot);
  }

  public async getENRForkID(): Promise<ENRForkID> {
    return {
      forkDigest: Buffer.alloc(4),
      nextForkEpoch: 100,
      nextForkVersion: Buffer.alloc(4),
    };
  }

  public getGenesisTime(): Number64 {
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

  async close(): Promise<void> {
    this.abortController.abort();
    return;
  }

  async getStateContextByBlockRoot(): Promise<ITreeStateContext | null> {
    return null;
  }
}
