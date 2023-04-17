import {defaultApiOptions, ApiOptions} from "../api/options.js";
import {defaultChainOptions, IChainOptions} from "../chain/options.js";
import {defaultDbOptions, DatabaseOptions} from "../db/options.js";
import {defaultEth1Options, Eth1Options} from "../eth1/options.js";
import {defaultMetricsOptions, MetricsOptions} from "../metrics/options.js";
import {defaultMonitoringOptions, MonitoringOptions} from "../monitoring/options.js";
import {defaultNetworkOptions, NetworkOptions} from "../network/options.js";
import {defaultSyncOptions, SyncOptions} from "../sync/options.js";
import {
  defaultExecutionEngineOpts,
  ExecutionEngineOpts,
  ExecutionBuilderOpts,
  defaultExecutionBuilderOpts,
} from "../execution/index.js";
// Re-export so the CLI doesn't need to depend on lodestar-api
export {allNamespaces} from "../api/rest/index.js";

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
