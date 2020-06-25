/**
 * @module node
 */

import defaultChainOptions, {IChainOptions} from "../chain/options";
import defaultDatabaseOptions, {IDatabaseOptions} from "../db/options";
import defaultApiOptions, {IApiOptions} from "../api/options";
import defaultEth1Options, {IEth1Options} from "../eth1/options";
import defaultNetworkOptions, {INetworkOptions} from "../network/options";
import defaultSyncOptions, {ISyncOptions} from "../sync/options";
import defaultLoggerOptions, {IBeaconLoggerOptions} from "./loggerOptions";
import defaultMetricsOptions, {IMetricsOptions} from "../metrics/options";

export interface IBeaconNodeOptions {
  chain: IChainOptions;
  db: IDatabaseOptions;
  api: IApiOptions;
  eth1: IEth1Options;
  network: INetworkOptions;
  sync: ISyncOptions;
  logger: Partial<IBeaconLoggerOptions>;
  metrics: IMetricsOptions;
}

const config: IBeaconNodeOptions = {
  chain: defaultChainOptions,
  db: defaultDatabaseOptions,
  api: defaultApiOptions,
  eth1: defaultEth1Options,
  network: defaultNetworkOptions,
  sync: defaultSyncOptions,
  logger: defaultLoggerOptions,
  metrics: defaultMetricsOptions,
};

export default config;
