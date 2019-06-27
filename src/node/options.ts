/**
 * @module node
 */

import defaultChainOptions, {IChainOptions} from "../chain/options";
import defaultDatabaseOptions, {IDatabaseOptions} from "../db/options";
import defaultApiOptions, {IPublicApiOptions} from "../rpc/options";
import defaultEth1Options, {IEth1Options} from "../eth1/options";
import defaultNetworkOptions, {INetworkOptions} from "../network/options";
import defaultOpPoolOptions, {IOpPoolOptions} from "../opPool/options";
import defaultSyncOptions, {ISyncOptions} from "../sync/options";
import {IValidatorOptions} from "../validator/options";

export interface IBeaconNodeOptions {
  chain: IChainOptions;
  db: IDatabaseOptions;
  api: IPublicApiOptions;
  eth1: IEth1Options;
  network: INetworkOptions;
  opPool: IOpPoolOptions;
  sync: ISyncOptions;
  validator?: IValidatorOptions;
}

export interface IConfigurableOptions {
  chain: IChainOptions;
}

const config: IBeaconNodeOptions = {
  chain: defaultChainOptions,
  db: defaultDatabaseOptions,
  api: defaultApiOptions,
  eth1: defaultEth1Options,
  network: defaultNetworkOptions,
  opPool: defaultOpPoolOptions,
  sync: defaultSyncOptions,
};

export default config;
