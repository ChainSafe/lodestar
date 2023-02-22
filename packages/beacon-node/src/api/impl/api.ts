import {Api, ServerApi} from "@lodestar/api";
import {ApiOptions} from "../options.js";
import {ApiModules} from "./types.js";
import {getBeaconApi} from "./beacon/index.js";
import {getConfigApi} from "./config/index.js";
import {getDebugApi} from "./debug/index.js";
import {getEventsApi} from "./events/index.js";
import {getLightclientApi} from "./lightclient/index.js";
import {getLodestarApi} from "./lodestar/index.js";
import {getNodeApi} from "./node/index.js";
import {getProofApi} from "./proof/index.js";
import {getValidatorApi} from "./validator/index.js";

export function getApi(opts: ApiOptions, modules: ApiModules): {[K in keyof Api]: ServerApi<Api[K]>} {
  return {
    beacon: getBeaconApi(modules),
    config: getConfigApi(modules),
    debug: getDebugApi(modules),
    events: getEventsApi(modules),
    lightclient: getLightclientApi(modules),
    lodestar: getLodestarApi(modules),
    node: getNodeApi(opts, modules),
    proof: getProofApi(opts, modules),
    validator: getValidatorApi(modules),
  };
}
