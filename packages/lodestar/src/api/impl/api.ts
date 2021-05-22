import {Api} from "@chainsafe/lodestar-api";
import {ApiModules} from "./types";
import {getBeaconApi} from "./beacon";
import {getConfigApi} from "./config";
import {getDebugApi} from "./debug";
import {getEventsApi} from "./events";
import {getLightclientApi} from "./lightclient";
import {getLodestarApi} from "./lodestar";
import {getNodeApi} from "./node";
import {getValidatorApi} from "./validator";

export function getApi(modules: ApiModules): Api {
  return {
    beacon: getBeaconApi(modules),
    config: getConfigApi(modules),
    debug: getDebugApi(modules),
    events: getEventsApi(modules),
    lightclient: getLightclientApi(modules),
    lodestar: getLodestarApi(modules),
    node: getNodeApi(modules),
    validator: getValidatorApi(modules),
  };
}
