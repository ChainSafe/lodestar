/**
 * @module rpc/api
 */
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
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
  new(args: {}, modules: {config: IBeaconConfig; chain: IBeaconChain; db: IBeaconDb; eth1: IEth1Notifier}): IApi;
}
