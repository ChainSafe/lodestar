import {defaultNetworkOptions, INetworkOptions} from "@lodestar/beacon-node/network/options";
import {defaultMetricsOptions, MetricsOptions} from "@lodestar/beacon-node/metrics/options";
import {defaultApiOptions, IApiOptions} from "../api/options.js";
import {defaultChainOptions, IChainOptions} from "../chain/options.js";
import {defaultDbOptions, IDatabaseOptions} from "../db/options.js";
import {defaultEth1Options, Eth1Options} from "../eth1/options.js";
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
  api: IApiOptions;
  chain: IChainOptions;
  db: IDatabaseOptions;
  eth1: Eth1Options;
  executionEngine: ExecutionEngineOpts;
  executionBuilder: ExecutionBuilderOpts;
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
  executionBuilder: defaultExecutionBuilderOpts,
  metrics: defaultMetricsOptions,
  network: defaultNetworkOptions,
  sync: defaultSyncOptions,
};
