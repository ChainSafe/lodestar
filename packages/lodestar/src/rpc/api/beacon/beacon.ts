/**
 * @module rpc/api
 */

import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BeaconBlock, BeaconState, bytes32, Fork, number64, SyncingStatus} from "@chainsafe/eth2.0-types";
import {IBeaconApi} from "./interface";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";
import {IApiModules} from "../interface";

export class BeaconApi implements IBeaconApi {

  public namespace: string;

  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private db: IBeaconDb;

  public constructor(opts: {}, {config, chain, db}: IApiModules) {
    this.namespace = "beacon";
    this.config = config;
    this.db = db;
    this.chain = chain;
  }


  public async getClientVersion(): Promise<bytes32> {
    return Buffer.from(`lodestar-${process.env.npm_package_version}`, "utf-8");
  }

  public async getFork(): Promise<Fork|null> {
    const state = await this.db.state.getLatest();
    return state ? state.fork : null;
  }

  public async getGenesisTime(): Promise<number64> {
    if(this.chain.latestState) {
      return this.chain.latestState.genesisTime;
    } else {
      return 0;
    }
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    // TODO: change this after sync service is implemented
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return false;
  }

  public async getBeaconState(): Promise<BeaconState|null> {
    return await this.db.state.getLatest();
  }

  public async getChainHead(): Promise<BeaconBlock|null> {
    return await this.db.block.getChainHead();
  }

}
