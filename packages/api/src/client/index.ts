import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Api} from "../interface";
import {IHttpClient, HttpClient, HttpClientOptions} from "./utils";

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
export function getClient(config: IBeaconConfig, opts: HttpClientOptions, httpClient?: IHttpClient): Api {
  if (!httpClient) httpClient = new HttpClient(opts);

  return {
    beacon: beacon.getClient(config, httpClient),
    config: configApi.getClient(httpClient),
    debug: debug.getClient(httpClient),
    events: events.getClient(httpClient.baseUrl),
    lightclient: lightclient.getClient(httpClient),
    lodestar: lodestar.getClient(httpClient),
    node: node.getClient(httpClient),
    validator: validator.getClient(httpClient),
  };
}
