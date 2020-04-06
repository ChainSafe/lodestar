/**
 * @module api/rpc
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  BeaconState,
  Bytes32,
  ForkResponse,
  Number64,
  SignedBeaconBlock,
  SyncingStatus,
  Uint64
} from "@chainsafe/lodestar-types";
import {IBeaconApi} from "./interface";
import {IBeaconChain} from "../../../chain";
import {IApiOptions} from "../../options";
import {IApiModules} from "../../interface";
import {ApiNamespace} from "../../index";
import EventIterator from "event-iterator/lib/event-iterator";

export class BeaconApi implements IBeaconApi {

  public namespace: ApiNamespace;

  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;

  public constructor(opts: Partial<IApiOptions>, modules: IApiModules) {
    this.namespace = ApiNamespace.BEACON;
    this.config = modules.config;
    this.chain = modules.chain;
  }

  public async getClientVersion(): Promise<Bytes32> {
    return Buffer.from(`lodestar-${process.env.npm_package_version}`, "utf-8");
  }

  public async getFork(): Promise<ForkResponse> {
    const state: BeaconState = await this.chain.getHeadState();
    const networkId: Uint64 = this.chain.networkId;
    const fork = state? state.fork : {
      previousVersion: Buffer.alloc(4),
      currentVersion: Buffer.alloc(4),
      epoch: 0
    };
    return {
      fork,
      chainId: networkId
    };
  }

  public async getGenesisTime(): Promise<Number64> {
    const state = await this.chain.getHeadState();
    if(state) {
      return state.genesisTime;
    }
    return 0;
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    // TODO: change this after sync service is implemented
    return false;
  }

  public getBlockStream(): AsyncIterable<SignedBeaconBlock> {
    return new EventIterator<SignedBeaconBlock>((push) => {
      this.chain.on("processedBlock", (block) => {
        console.log("new block");
        push(block);
      });
    });
  }
}
