import {EventEmitter} from "events";

import {
  BeaconState,
  Checkpoint,
  ENRForkID,
  ForkDigest,
  Number64,
  SignedBeaconBlock,
  Slot,
  Uint16,
  Uint64
} from "@chainsafe/lodestar-types";
import {IBeaconChain, ILMDGHOST} from "../../../../src/chain";
import {IBeaconClock} from "../../../../src/chain/clock/interface";
import {computeForkDigest, EpochContext, IStateContext} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {generateEmptySignedBlock} from "../../block";

export interface IMockChainParams {
  genesisTime: Number64;
  chainId: Uint16;
  networkId: Uint64;
  state: BeaconState;
  config: IBeaconConfig;
}

export class MockBeaconChain extends EventEmitter implements IBeaconChain {
  public forkChoice: ILMDGHOST;
  public chainId: Uint16;
  public networkId: Uint64;
  public clock: IBeaconClock;

  private state: BeaconState|null;
  private config: IBeaconConfig;

  public constructor({chainId, networkId, state, config}: Partial<IMockChainParams>) {
    super();
    this.chainId = chainId || 0;
    this.networkId = networkId ||BigInt(0);
    this.state = state;
    this.config = config;
  }

  getHeadBlock(): Promise<| null> {
    return undefined;
  }

  public async getHeadStateContext(): Promise<IStateContext| null> {
    return {
      state: this.state,
      epochCtx: new EpochContext(this.config)
    };
  }

  public async getBlockAtSlot(slot: Slot): Promise<SignedBeaconBlock|null> {
    const block = generateEmptySignedBlock();
    block.message.slot = slot;
    return block;
  }

  public async getHeadEpochContext(): Promise<EpochContext> {
    return (await this.getHeadStateContext()).epochCtx;
  }

  public async getHeadState(): Promise<BeaconState> {
    return (await this.getHeadStateContext()).state;
  }

  public async getUnfinalizedBlocksAtSlots(slots: Slot[]): Promise<SignedBeaconBlock[]|null> {
    if (!slots) {
      return [];
    }
    return await Promise.all(slots.map(this.getBlockAtSlot));
  }

  public async getFinalizedCheckpoint(): Promise<Checkpoint> {
    return this.state.finalizedCheckpoint;
  }

  public get currentForkDigest(): ForkDigest {
    return computeForkDigest(this.config, this.state.fork.currentVersion, this.state.genesisValidatorsRoot);
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

  receiveAttestation(): Promise<void> {
    return undefined;
  }

  receiveBlock(): Promise<void> {
    return undefined;
  }

  start(): Promise<void> {
    return undefined;
  }

  stop(): Promise<void> {
    return undefined;
  }

}
