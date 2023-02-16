import {IBeaconNodeOptions} from "@lodestar/beacon-node";
import {RecursivePartial} from "@lodestar/utils";
import {removeUndefinedRecursive} from "../../util/index.js";
import * as api from "./api.js";
import * as builder from "./builder.js";
import * as chain from "./chain.js";
import * as eth1 from "./eth1.js";
import * as execution from "./execution.js";
import * as metrics from "./metrics.js";
import * as monitoring from "./monitoring.js";
import * as network from "./network.js";
import * as sync from "./sync.js";

export type IBeaconNodeArgs = api.IApiArgs &
  chain.IChainArgs &
  eth1.IEth1Args &
  execution.ExecutionEngineArgs &
  builder.ExecutionBuilderArgs &
  metrics.IMetricsArgs &
  monitoring.IMonitoringArgs &
  network.INetworkArgs &
  sync.ISyncArgs;

export function parseBeaconNodeArgs(args: IBeaconNodeArgs): RecursivePartial<IBeaconNodeOptions> {
  // Remove undefined values to allow deepmerge to inject default values downstream
  return removeUndefinedRecursive({
    api: api.parseArgs(args),
    chain: chain.parseArgs(args),
    // db: {},
    eth1: eth1.parseArgs(args),
    executionEngine: execution.parseArgs(args),
    executionBuilder: builder.parseArgs(args),
    metrics: metrics.parseArgs(args),
    monitoring: monitoring.parseArgs(args),
    network: network.parseArgs(args),
    sync: sync.parseArgs(args),
  });
}

export const beaconNodeOptions = {
  ...api.options,
  ...chain.options,
  ...eth1.options,
  ...execution.options,
  ...builder.options,
  ...metrics.options,
  ...monitoring.options,
  ...network.options,
  ...sync.options,
};
