import {Api} from "@chainsafe/lodestar-api";
import {IApiOptions} from "../options.js";
import {ApiModules} from "./types.js";
import {getBeaconApi} from "./beacon/index.js";
import {getConfigApi} from "./config/index.js";
import {getDebugApi} from "./debug/index.js";
import {getEventsApi} from "./events/index.js";
import {getLightclientApi} from "./lightclient/index.js";
import {getLodestarApi} from "./lodestar/index.js";
import {getNodeApi} from "./node/index.js";
import {getValidatorApi} from "./validator/index.js";

export function getApi(opts: IApiOptions, modules: ApiModules): Api {
  return {
    beacon: getBeaconApi(modules),
    config: getConfigApi(modules),
    debug: getDebugApi(modules),
    events: getEventsApi(modules),
    lightclient: getLightclientApi(opts, modules),
    lodestar: getLodestarApi(modules),
    node: getNodeApi(opts, modules),
    validator: getValidatorApi(modules),
  };
}
