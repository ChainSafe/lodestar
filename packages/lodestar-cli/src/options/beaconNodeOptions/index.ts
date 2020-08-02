import {IBeaconNodeOptions as _IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {apiOptions} from "./api";
import {eth1Options} from "./eth1";
import {loggerOptions} from "./logger";
import {metricsOptions} from "./metrics";
import {networkOptions} from "./network";

type RecursivePartial<T> = {
  [P in keyof T]?:
  T[P] extends (infer U)[] ? RecursivePartial<U>[] :
    T[P] extends object ? RecursivePartial<T[P]> :
      T[P];
};

// Re-export for convenience
export type IBeaconNodeOptions = _IBeaconNodeOptions;
export type IBeaconNodeOptionsPartial = RecursivePartial<_IBeaconNodeOptions>;

export const beaconNodeOptions = {
  ...apiOptions,
  ...eth1Options,
  ...loggerOptions,
  ...metricsOptions,
  ...networkOptions,
};
