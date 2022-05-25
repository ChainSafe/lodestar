/**
 * @module node
 */

import {defaultApiOptions, IApiOptions} from "../api/options.js";
import {defaultChainOptions, IChainOptions} from "../chain/options.js";
import {defaultDbOptions, IDatabaseOptions} from "../db/options.js";
import {defaultEth1Options, Eth1Options} from "../eth1/options.js";
import {defaultLoggerOptions, IBeaconLoggerOptions} from "./loggerOptions.js";
import {defaultMetricsOptions, MetricsOptions} from "../metrics/options.js";
import {defaultNetworkOptions, INetworkOptions} from "../network/options.js";
import {defaultSyncOptions, SyncOptions} from "../sync/options.js";
import {defaultExecutionEngineOpts, ExecutionEngineOpts} from "../executionEngine/index.js";
// Re-export so the CLI doesn't need to depend on lodestar-api
export {allNamespaces} from "../api/rest/index.js";

export interface IBeaconNodeOptions {
  api: IApiOptions;
  chain: IChainOptions;
  db: IDatabaseOptions;
  eth1: Eth1Options;
  executionEngine: ExecutionEngineOpts;
  logger: IBeaconLoggerOptions;
  metrics: MetricsOptions;
  network: INetworkOptions;
  sync: SyncOptions;
}

export const defaultOptions: IBeaconNodeOptions = {
  api: defaultApiOptions,
  chain: defaultChainOptions,
  db: defaultDbOptions,
  eth1: defaultEth1Options,
  executionEngine: defaultExecutionEngineOpts,
  logger: defaultLoggerOptions,
  metrics: defaultMetricsOptions,
  network: defaultNetworkOptions,
  sync: defaultSyncOptions,
};
