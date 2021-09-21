/**
 * @module node
 */

import {defaultApiOptions, IApiOptions} from "../api/options";
import {defaultChainOptions, IChainOptions} from "../chain/options";
import {defaultDbOptions, IDatabaseOptions} from "../db/options";
import {defaultEth1Options, IEth1Options} from "../eth1/options";
import {defaultLoggerOptions, IBeaconLoggerOptions} from "./loggerOptions";
import {defaultMetricsOptions, IMetricsOptions} from "../metrics/options";
import {defaultNetworkOptions, INetworkOptions} from "../network/options";
import {defaultSyncOptions, SyncOptions} from "../sync/options";
// Re-export so the CLI doesn't need to depend on lodestar-api
export {allNamespaces} from "../api/rest/index";

export interface IBeaconNodeOptions {
  api: IApiOptions;
  chain: IChainOptions;
  db: IDatabaseOptions;
  eth1: IEth1Options;
  logger: IBeaconLoggerOptions;
  metrics: IMetricsOptions;
  network: INetworkOptions;
  sync: SyncOptions;
}

export const defaultOptions: IBeaconNodeOptions = {
  api: defaultApiOptions,
  chain: defaultChainOptions,
  db: defaultDbOptions,
  eth1: defaultEth1Options,
  logger: defaultLoggerOptions,
  metrics: defaultMetricsOptions,
  network: defaultNetworkOptions,
  sync: defaultSyncOptions,
};
