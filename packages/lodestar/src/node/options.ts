/**
 * @module node
 */

import {defaultApiOptions, IApiOptions} from "../api/options";
import {defaultChainOptions, IChainOptions} from "../chain/options";
import {defaultDbOptions, IDatabaseOptions} from "../db/options";
import {defaultEth1Options, Eth1Options} from "../eth1/options";
import {defaultLoggerOptions, IBeaconLoggerOptions} from "./loggerOptions";
import {defaultMetricsOptions, MetricsOptions} from "../metrics/options";
import {defaultNetworkOptions, INetworkOptions} from "../network/options";
import {defaultSyncOptions, SyncOptions} from "../sync/options";
import {defaultExecutionEngineOpts, ExecutionEngineOpts, defaultDefaultSuggestedFeeRecipient} from "../executionEngine";
// Re-export so the CLI doesn't need to depend on lodestar-api
export {allNamespaces} from "../api/rest/index";
export {defaultDefaultSuggestedFeeRecipient};

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
