/**
 * @module api/rpc
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Bytes32, Fork, Number64, SyncingStatus, Uint64} from "@chainsafe/lodestar-types";
import {IBeaconApi} from "./interface";
import {IBeaconChain} from "../../../../chain";
import {IBeaconDb} from "../../../../db";
import {IApiOptions} from "../../../options";
import {IApiModules} from "../../../interface";
import {ApiNamespace} from "../../../index";
import {getFork} from "../../../impl/beacon/fork";

export class BeaconApi implements IBeaconApi {

  public namespace: ApiNamespace;

  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private db: IBeaconDb;

  public constructor(opts: Partial<IApiOptions>, modules: IApiModules) {
    this.namespace = ApiNamespace.BEACON;
    this.config = modules.config;
    this.db = modules.db;
    this.chain = modules.chain;
  }


  public async getClientVersion(): Promise<Bytes32> {
    return Buffer.from(`lodestar-${process.env.npm_package_version}`, "utf-8");
  }

  public async getFork(): Promise<{fork: Fork; chainId: Uint64}> {
    return getFork(this.db, this.chain);
  }

  public async getGenesisTime(): Promise<Number64> {
    if (this.chain.latestState) {
      return this.chain.latestState.genesisTime;
    }
    return 0;
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    // TODO: change this after sync service is implemented
    return false;
  }
}
