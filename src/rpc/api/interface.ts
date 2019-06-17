/**
 * @module rpc/api
 */
import {BeaconChain} from "../../chain";
import {BeaconDB} from "../../db/api";
import {IEth1Notifier} from "../../eth1";

export interface IApi {
  /**
   * Name space for API commands
   */
  namespace: string;
}

export interface IApiConstructor {
  new(args, modules: {chain: BeaconChain; db: BeaconDB; eth1: IEth1Notifier}): IApi;
}
