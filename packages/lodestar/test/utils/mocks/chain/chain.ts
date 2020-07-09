import {EventEmitter} from "events";

import {
  BeaconState,
  Checkpoint,
  ENRForkID,
  ForkDigest, HeadResponse,
  Number64,
  SignedBeaconBlock,
  Slot,
  Uint16,
  Uint64
} from "@chainsafe/lodestar-types";
import {IBeaconChain, ILMDGHOST} from "../../../../src/chain";
import {IBeaconClock} from "../../../../src/chain/clock/interface";
import {ZERO_HASH} from "../../../../src/constants";
import {computeForkDigest, EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {generateEmptySignedBlock} from "../../block";
import {ITreeStateContext} from "../../../../src/db/api/beacon/stateContextCache";
import {TreeBacked} from "@chainsafe/ssz";
import PeerId from "peer-id";

export interface IMockChainParams {
  genesisTime: Number64;
  chainId: Uint16;
  networkId: Uint64;
  state: TreeBacked<BeaconState>;
  config: IBeaconConfig;
}

export class MockBeaconChain extends EventEmitter implements IBeaconChain {
  public forkChoice: ILMDGHOST;
  public chainId: Uint16;
  public networkId: Uint64;
  public clock: IBeaconClock;

  private state: TreeBacked<BeaconState>|null;
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

  public async getHeadStateContext(): Promise<ITreeStateContext| null> {
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

  public async getHeadState(): Promise<TreeBacked<BeaconState>> {
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

  public async getHead(): Promise<HeadResponse> {
    return {
      headSlot: 0,
      headBlockRoot: ZERO_HASH,
      finalizedSlot: 0,
      finalizedBlockRoot: ZERO_HASH,
      justifiedSlot: 0,
      justifiedBlockRoot: ZERO_HASH,
    };
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

  public async getPeers(): Promise<PeerId[]> {
    return [];
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
