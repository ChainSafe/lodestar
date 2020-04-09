import {EventEmitter} from "events";

import {Number64, Uint16, Uint64} from "@chainsafe/lodestar-types";
import {IBeaconChain, ILMDGHOST} from "../../../../src/chain";
import {ITreeBacked, List, TreeBackedify} from "@chainsafe/ssz";
import {IBeaconClock} from "../../../../src/chain/clock/interface";
import {BeaconState} from "@chainsafe/lodestar-types";

export interface IMockChainParams {
  genesisTime: Number64;
  chainId: Uint16;
  networkId: Uint64;
  state: BeaconState;
}

export class MockBeaconChain extends EventEmitter implements IBeaconChain {
  public forkChoice: ILMDGHOST;
  public chainId: Uint16;
  public networkId: Uint64;
  public clock: IBeaconClock;

  private initialized: boolean;
  private state: BeaconState|null;

  public constructor({genesisTime, chainId, networkId, state}: Partial<IMockChainParams>) {
    super();
    this.initialized = genesisTime > 0;
    this.chainId = chainId || 0;
    this.networkId = networkId || 0n;
    this.state = state; 
  }

  getHeadBlock(): Promise<| null> {
    return undefined;
  }

  public async getHeadState(): Promise<BeaconState| null> {
    return this.state;
  }

  public async initializeBeaconChain(): Promise<void> {
    return undefined;
  }

  isInitialized(): boolean {
    return !!this.initialized;
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
