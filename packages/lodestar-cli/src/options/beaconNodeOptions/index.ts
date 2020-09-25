import {IBeaconNodeOptions as _IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {apiOptions, toApiOptions, IBeaconNodeApiArgs} from "./api";
import {eth1Options, toEth1Options, IBeaconNodeEth1Args} from "./eth1";
import {loggerOptions, toLoggerOptions, IBeaconNodeLoggerArgs} from "./logger";
import {metricsOptions, toMetricsOptions, IBeaconNodeMetricsArgs} from "./metrics";
import {networkOptions, toNetworkOptions, IBeaconNodeNetworkArgs} from "./network";
import {syncOptions, toSyncOptions, IBeaconNodeSyncArgs} from "./sync";

type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? RecursivePartial<U>[]
    : T[P] extends object
    ? RecursivePartial<T[P]>
    : T[P];
};

export type ICliArgsBeaconNode = IBeaconNodeApiArgs &
  IBeaconNodeEth1Args &
  IBeaconNodeLoggerArgs &
  IBeaconNodeMetricsArgs &
  IBeaconNodeNetworkArgs &
  IBeaconNodeSyncArgs;

export function toBeaconNodeOptions(args: ICliArgsBeaconNode): _IBeaconNodeOptions {
  return {
    api: toApiOptions(args),
    chain: {},
    db: {},
    eth1: toEth1Options(args),
    logger: toLoggerOptions(args),
    metrics: toMetricsOptions(args),
    network: toNetworkOptions(args),
    sync: toSyncOptions(args),
  };
}

// Re-export for convenience
export type IBeaconNodeOptions = _IBeaconNodeOptions;
export type IBeaconNodeOptionsPartial = RecursivePartial<_IBeaconNodeOptions>;

export const beaconNodeOptions = {
  ...apiOptions,
  ...eth1Options,
  ...loggerOptions,
  ...metricsOptions,
  ...networkOptions,
  ...syncOptions,
};
