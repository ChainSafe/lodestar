import {EventEmitter} from "events";

import {Number64, Uint16, Uint64, ForkDigest, ENRForkID, Checkpoint} from "@chainsafe/lodestar-types";
import {IBeaconChain, ILMDGHOST} from "../../../../src/chain";
import {IBeaconClock} from "../../../../src/chain/clock/interface";
import {BeaconState} from "@chainsafe/lodestar-types";
import {computeForkDigest} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

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

  public constructor({genesisTime, chainId, networkId, state, config}: Partial<IMockChainParams>) {
    super();
    this.chainId = chainId || 0;
    this.networkId = networkId || 0n;
    this.state = state;
    this.config = config;
  }

  getHeadBlock(): Promise<| null> {
    return undefined;
  }

  public async getHeadState(): Promise<BeaconState| null> {
    return this.state;
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
    return undefined;
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
