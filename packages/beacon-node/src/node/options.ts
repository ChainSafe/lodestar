import {ApiOptions, defaultApiOptions} from "../api/options.js";
import {DEFAULT_STATE_ARCHIVE_MODE, IChainOptions, StateArchiveMode, defaultChainOptions} from "../chain/options.js";
import {DatabaseOptions, defaultDbOptions} from "../db/options.js";
import {Eth1Options, defaultEth1Options} from "../eth1/options.js";
import {
  ExecutionBuilderOpts,
  ExecutionEngineOpts,
  defaultExecutionBuilderHttpOpts,
  defaultExecutionBuilderOpts,
  defaultExecutionEngineHttpOpts,
  defaultExecutionEngineOpts,
} from "../execution/index.js";
import {MetricsOptions, defaultMetricsOptions} from "../metrics/options.js";
import {MonitoringOptions, defaultMonitoringOptions} from "../monitoring/options.js";
import {NetworkOptions, defaultNetworkOptions} from "../network/options.js";
import {SyncOptions, defaultSyncOptions} from "../sync/options.js";
// Re-export so the CLI doesn't need to depend on lodestar-api
export {allNamespaces} from "../api/rest/index.js";

// Re-export to use as default values in CLI args
export {defaultExecutionEngineHttpOpts, defaultExecutionBuilderHttpOpts, StateArchiveMode, DEFAULT_STATE_ARCHIVE_MODE};

export interface IBeaconNodeOptions {
  api: ApiOptions;
  chain: IChainOptions;
  db: DatabaseOptions;
  eth1: Eth1Options;
  executionEngine: ExecutionEngineOpts;
  executionBuilder: ExecutionBuilderOpts;
  metrics: MetricsOptions;
  monitoring: MonitoringOptions;
  network: NetworkOptions;
  sync: SyncOptions;
}

export const defaultOptions: IBeaconNodeOptions = {
  api: defaultApiOptions,
  chain: defaultChainOptions,
  db: defaultDbOptions,
  eth1: defaultEth1Options,
  executionEngine: defaultExecutionEngineOpts,
  executionBuilder: defaultExecutionBuilderOpts,
  metrics: defaultMetricsOptions,
  monitoring: defaultMonitoringOptions,
  network: defaultNetworkOptions,
  sync: defaultSyncOptions,
};
