/**
 * @module api
 */
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconChain} from "../chain";
import {IBeaconDb} from "../db/api";
import {IEth1Notifier} from "../eth1";
import {IApiOptions} from "./options";

export interface IApiModules {
    config: IBeaconConfig;
    chain: IBeaconChain;
    db: IBeaconDb;
    eth1: IEth1Notifier;
}

export interface IApiConstructor {

    new(opts: Partial<IApiOptions>, modules: IApiModules): IApi;

}

export interface IApi {

    /**
     * Name space for API commands
     */
    namespace: string;

}
