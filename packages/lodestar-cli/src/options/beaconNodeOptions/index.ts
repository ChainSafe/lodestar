import {IBeaconNodeOptions as _IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {apiOptions} from "./api";
import {chainOptions} from "./chain";
import {eth1Options} from "./eth1";
import {loggerOptions} from "./logger";
import {metricsOptions} from "./metrics";
import {networkOptions} from "./network";

// Re-export for convenience
export type IBeaconNodeOptions = Partial<_IBeaconNodeOptions>;

export const beaconNodeOptions = {
  ...apiOptions,
  ...chainOptions,
  ...eth1Options,
  ...loggerOptions,
  ...metricsOptions,
  ...networkOptions,
};
