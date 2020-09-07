import {EventEmitter} from "events";
import {createStubInstance} from "sinon";
import AbortController from "abort-controller";

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
import {ChainEventEmitter, IBeaconChain, ILMDGHOST} from "../../../../src/chain";
import {IBeaconClock} from "../../../../src/chain/clock/interface";
import {computeForkDigest, EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {generateEmptySignedBlock} from "../../block";
import {ITreeStateContext} from "../../../../src/db/api/beacon/stateContextCache";
import {TreeBacked} from "@chainsafe/ssz";
import {LocalClock} from "../../../../src/chain/clock";

export interface IMockChainParams {
  genesisTime: Number64;
  chainId: Uint16;
  networkId: Uint64;
  state: TreeBacked<BeaconState>;
  config: IBeaconConfig;
}

export class MockBeaconChain implements IBeaconChain {
  public forkChoice!: ILMDGHOST;
  public chainId: Uint16;
  public networkId: Uint64;
  public clock!: IBeaconClock;
  public emitter: ChainEventEmitter;

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
  }

  async getHeadBlock(): Promise<null> {
    return null;
  }

  public async getHeadStateContext(): Promise<ITreeStateContext> {
    return {
      state: this.state!,
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
    return (await this.getHeadStateContext()).state;
  }

  public async getState(stateRoot: Uint8Array): Promise<TreeBacked<BeaconState>> {
    return (await this.getHeadStateContext()).state;
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

  public get currentForkDigest(): ForkDigest {
    return computeForkDigest(this.config, this.state!.fork.currentVersion, this.state!.genesisValidatorsRoot);
  }

  public async initializeBeaconChain(): Promise<void> {
    return undefined;
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

  async start(): Promise<void> {
    return;
  }

  async stop(): Promise<void> {
    this.abortController.abort();
    return;
  }

  async getStateContextByBlockRoot(): Promise<ITreeStateContext | null> {
    return null;
  }
}
