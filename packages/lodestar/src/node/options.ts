/**
 * @module node
 */

import defaultChainOptions, {ChainOptions, IChainOptions} from "../chain/options";
import defaultDatabaseOptions, {DatabaseOptions, IDatabaseOptions} from "../db/options";
import defaultApiOptions, {IPublicApiOptions, PublicApiOptions} from "../rpc/options";
import defaultEth1Options, {Eth1Options, IEth1Options} from "../eth1/options";
import defaultNetworkOptions, {INetworkOptions, NetworkOptions} from "../network/options";
import defaultOpPoolOptions, {IOpPoolOptions, OpPoolOptions} from "../opPool/options";
import defaultSyncOptions, {ISyncOptions, SyncOptions} from "../sync/options";
import defaultMetricsOptions, {IMetricsOptions} from "../metrics/options";
import {IValidatorOptions, ValidatorOptions} from "../validator/options";
import {IConfigurationModule} from "../util/config";

export interface IBeaconNodeOptions {
  chain: IChainOptions;
  db: IDatabaseOptions;
  api: IPublicApiOptions;
  eth1: IEth1Options;
  network: INetworkOptions;
  opPool: IOpPoolOptions;
  sync: ISyncOptions;
  metrics: IMetricsOptions;
  validator?: IValidatorOptions;
}

export const BeaconNodeOptions: IConfigurationModule = {
  name: 'config',
  fields: [
    ChainOptions,
    DatabaseOptions,
    PublicApiOptions,
    Eth1Options,
    NetworkOptions,
    OpPoolOptions,
    SyncOptions,
    ValidatorOptions
  ]
};

const config: IBeaconNodeOptions = {
  chain: defaultChainOptions,
  db: defaultDatabaseOptions,
  api: defaultApiOptions,
  eth1: defaultEth1Options,
  network: defaultNetworkOptions,
  opPool: defaultOpPoolOptions,
  sync: defaultSyncOptions,
  metrics: defaultMetricsOptions,
};

export default config;
