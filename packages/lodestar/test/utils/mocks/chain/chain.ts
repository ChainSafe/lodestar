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
import {computeForkDigest} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ChainEventEmitter, IBeaconChain} from "../../../../src/chain";
import {IBeaconClock} from "../../../../src/chain/clock/interface";
import {generateEmptySignedBlock} from "../../block";
import {LocalClock} from "../../../../src/chain/clock";
import {IStateRegenerator, StateRegenerator} from "../../../../src/chain/regen";
import {StubbedBeaconDb} from "../../stub";
import {BlockPool} from "../../../../src/chain/blocks";
import {AttestationPool} from "../../../../src/chain/attestation";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
import {generateCachedState} from "../../state";

export interface IMockChainParams {
  genesisTime: Number64;
  chainId: Uint16;
  networkId: Uint64;
  state: TreeBacked<BeaconState>;
  config: IBeaconConfig;
}

export class MockBeaconChain implements IBeaconChain {
  public forkChoice!: IForkChoice;
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
      db: new StubbedBeaconDb(sinon),
    });
  }

  async getHeadBlock(): Promise<null> {
    return null;
  }

  public async getHeadStateContext(): Promise<CachedBeaconState> {
    return generateCachedState();
  }

  public async getHeadStateContextAtCurrentEpoch(): Promise<CachedBeaconState> {
    return generateCachedState();
  }

  public async getHeadStateContextAtCurrentSlot(): Promise<CachedBeaconState> {
    return generateCachedState();
  }

  public async getCanonicalBlockAtSlot(slot: Slot): Promise<SignedBeaconBlock> {
    const block = generateEmptySignedBlock();
    block.message.slot = slot;
    return block;
  }

  public async getHeadState(): Promise<TreeBacked<BeaconState>> {
    return (await this.getHeadStateContext()).getTreeBackedState();
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

  async getStateContextByBlockRoot(): Promise<CachedBeaconState | null> {
    return null;
  }
}
