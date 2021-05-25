import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Api} from "../interface";
import {FetchFn} from "../utils";

import * as beacon from "./beacon";
import * as configApi from "./config";
import * as debug from "./debug";
import * as events from "./events";
import * as lightclient from "./lightclient";
import * as lodestar from "./lodestar";
import * as node from "./node";
import * as validator from "./validator";

/**
 * REST HTTP client for all routes
 */
export function getClient(config: IBeaconConfig, fetchFn: FetchFn, baseUrl: string): Api {
  return {
    beacon: beacon.getClient(config, fetchFn),
    config: configApi.getClient(config, fetchFn),
    debug: debug.getClient(config, fetchFn),
    events: events.getClient(config, baseUrl),
    lightclient: lightclient.getClient(config, fetchFn),
    lodestar: lodestar.getClient(config, fetchFn),
    node: node.getClient(config, fetchFn),
    validator: validator.getClient(config, fetchFn),
  };
}
