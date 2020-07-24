import {apiOptions} from "./api";
import {chainOptions} from "./chain";
import {eth1Options} from "./eth1";
import {loggerOptions} from "./logger";
import {metricsOptions} from "./metrics";
import {networkOptions} from "./network";
import {paramsOptions} from "./params";

export const beaconRunOptions = {
  ...apiOptions,
  ...chainOptions,
  ...eth1Options,
  ...loggerOptions,
  ...metricsOptions,
  ...networkOptions,
  ...paramsOptions,
};
