/**
 * @module rpc/api
 */

import {IBeaconApi} from "./interface";
import {BeaconBlock, BeaconState, bytes32, Fork, number64, SyncingStatus} from "../../../types";
import {BeaconChain} from "../../../chain";
import {DB} from "../../../db";

export class BeaconApi implements IBeaconApi {

  public namespace: string;

  private chain: BeaconChain;
  private db: DB;

  public constructor(opts, {chain, db}) {
    this.namespace = 'beacon';
    this.db = db;
    this.chain = chain;
  }


  public async getClientVersion(): Promise<bytes32> {
    return Buffer.alloc(32);
  }

  public async getFork(): Promise<Fork> {
    const state: BeaconState = await this.db.getState();
    return state.fork;
  }

  public async getGenesisTime(): Promise<number64> {
    return await this.chain.genesisTime;
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as boolean | SyncingStatus;
  }

  public async getBeaconState(): Promise<BeaconState> {
    return await this.db.getState();
  }

  public async getChainHead(): Promise<BeaconBlock> {
    return await this.db.getChainHead();
  }

}
