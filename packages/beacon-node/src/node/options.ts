import {defaultApiOptions, IApiOptions} from "../api/options.js";
import {defaultChainOptions, IChainOptions} from "../chain/options.js";
import {defaultEth1Options, Eth1Options} from "../eth1/options.js";
import {defaultMetricsOptions, MetricsOptions} from "../metrics/options.js";
import {defaultNetworkOptions, INetworkOptions} from "../network/options.js";
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
  api?: IApiOptions;
  chain?: IChainOptions;
  eth1?: Eth1Options;
  executionEngine?: ExecutionEngineOpts;
  executionBuilder?: ExecutionBuilderOpts;
  metrics?: MetricsOptions;
  network?: INetworkOptions;
  sync?: SyncOptions;
}

export const defaultOptions = {
  api: defaultApiOptions,
  chain: defaultChainOptions,
  eth1: defaultEth1Options,
  executionEngine: defaultExecutionEngineOpts,
  executionBuilder: defaultExecutionBuilderOpts,
  metrics: defaultMetricsOptions,
  network: defaultNetworkOptions,
  sync: defaultSyncOptions,
};
