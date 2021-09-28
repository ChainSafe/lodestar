import {IBeaconNodeOptions} from "@chainsafe/lodestar";
import {RecursivePartial} from "@chainsafe/lodestar-utils";
import {removeUndefinedRecursive} from "../../util";
import * as api from "./api";
import * as chain from "./chain";
import * as eth1 from "./eth1";
import * as execution from "./execution";
import * as logger from "./logger";
import * as metrics from "./metrics";
import * as network from "./network";
import * as sync from "./sync";

export type IBeaconNodeArgs = api.IApiArgs &
  chain.IChainArgs &
  eth1.IEth1Args &
  execution.ExecutionEngineArgs &
  logger.ILoggerArgs &
  metrics.IMetricsArgs &
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
    logger: logger.parseArgs(args),
    metrics: metrics.parseArgs(args),
    network: network.parseArgs(args),
    sync: sync.parseArgs(args),
  });
}

export const beaconNodeOptions = {
  ...api.options,
  ...chain.options,
  ...eth1.options,
  ...execution.options,
  ...logger.options,
  ...metrics.options,
  ...network.options,
  ...sync.options,
};
