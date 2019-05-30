/**
 * @module rpc/api
 */

import {IBeaconApi} from "./interface";
import {BeaconBlock, BeaconState, bytes32, Fork, number64, SyncingStatus} from "../../../types";
import {BeaconChain} from "../../../chain";
import {BeaconDB} from "../../../db";

export class BeaconApi implements IBeaconApi {

  public namespace: string;

  private chain: BeaconChain;
  private db: BeaconDB;

  public constructor(opts, {chain, db}) {
    this.namespace = 'beacon';
    this.db = db;
    this.chain = chain;
  }


  public async getClientVersion(): Promise<bytes32> {
    return Buffer.from(`lodestar-${process.env.npm_package_version}`, 'utf-8');
  }

  public async getFork(): Promise<Fork> {
    const state: BeaconState = await this.db.getState();
    return state.fork;
  }

  public async getGenesisTime(): Promise<number64> {
    return await this.chain.genesisTime;
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    // TODO: change this after sync service is implemented
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return false;
  }

  public async getBeaconState(): Promise<BeaconState> {
    return await this.db.getState();
  }

  public async getChainHead(): Promise<BeaconBlock> {
    return await this.db.getChainHead();
  }

}
