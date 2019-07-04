/**
 * @module rpc/api
 */
import {BeaconConfig} from "../../config";
import {IBeaconChain} from "../../chain";
import {IBeaconDb} from "../../db/api";
import {IEth1Notifier} from "../../eth1";

export interface IApi {
  /**
   * Name space for API commands
   */
  namespace: string;
}

export interface IApiConstructor {
  new(args, modules: {config: BeaconConfig; chain: IBeaconChain; db: IBeaconDb; eth1: IEth1Notifier}): IApi;
}
