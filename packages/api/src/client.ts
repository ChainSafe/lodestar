import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Api} from "./interface";
import {FetchFn, getGenericClient} from "./utils";
import * as routes from "./routes";
import * as events from "./routes/events";

/* eslint-disable import/namespace */

export function getClient(config: IBeaconConfig, fetchFn: FetchFn, baseUrl: string): Api {
  return {
    beacon: getGenericClient<routes.beacon.Api, routes.beacon.ReqTypes>(routes.beacon, config, fetchFn),
    config: getGenericClient<routes.config.Api, routes.config.ReqTypes>(routes.config, config, fetchFn),
    debug: getGenericClient<routes.debug.Api, routes.debug.ReqTypes>(routes.debug, config, fetchFn),
    events: events.getClient(config, baseUrl),
    lightclient: getGenericClient<routes.lightclient.Api, routes.lightclient.ReqTypes>(
      routes.lightclient,
      config,
      fetchFn
    ),
    lodestar: getGenericClient<routes.lodestar.Api, routes.lodestar.ReqTypes>(routes.lodestar, config, fetchFn),
    node: getGenericClient<routes.node.Api, routes.node.ReqTypes>(routes.node, config, fetchFn),
    validator: getGenericClient<routes.validator.Api, routes.validator.ReqTypes>(routes.validator, config, fetchFn),
  };
}
