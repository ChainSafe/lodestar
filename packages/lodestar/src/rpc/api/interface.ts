/**
 * @module rpc/api
 */
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconChain} from "../../chain";
import {IBeaconDb} from "../../db/api";
import {IEth1Notifier} from "../../eth1";
import {OpPool} from "../../opPool";

export interface IApi {
  /**
     * Name space for API commands
     */
  namespace: string;
}

export interface IApiModules {
  config: IBeaconConfig;
  chain: IBeaconChain;
  db: IBeaconDb;
  opPool: OpPool;
  eth1: IEth1Notifier;
}

export interface IApiConstructor {
  new(args: {}, modules: IApiModules): IApi;
}
