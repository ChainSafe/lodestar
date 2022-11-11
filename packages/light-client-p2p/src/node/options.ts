import {defaultNetworkOptions, INetworkOptions} from "@lodestar/beacon-node/network/options";
import {defaultMetricsOptions, MetricsOptions} from "@lodestar/beacon-node/metrics/options";
import {defaultEth1Options, Eth1Options} from "@lodestar/beacon-node/eth1/options";
import {
  defaultExecutionBuilderOpts,
  defaultExecutionEngineOpts,
  ExecutionBuilderOpts,
  ExecutionEngineOpts,
} from "@lodestar/beacon-node/execution";
import {defaultApiOptions, IApiOptions} from "@lodestar/beacon-node/api/options";
import {defaultChainOptions, IChainOptions} from "../chain/options.js";
import {defaultDbOptions, IDatabaseOptions} from "../db/options.js";
import {defaultSyncOptions, SyncOptions} from "../sync/options.js";

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
