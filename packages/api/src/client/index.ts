import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Api} from "../interface";
import {IHttpClient, HttpClient, HttpClientOptions, HttpError} from "./utils";
export {HttpClient, HttpClientOptions, HttpError};

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
export function getClient(config: IChainForkConfig, opts: HttpClientOptions, httpClient?: IHttpClient): Api {
  if (!httpClient) httpClient = new HttpClient(opts);

  return {
    beacon: beacon.getClient(config, httpClient),
    config: configApi.getClient(config, httpClient),
    debug: debug.getClient(config, httpClient),
    events: events.getClient(config, httpClient.baseUrl),
    lightclient: lightclient.getClient(config, httpClient),
    lodestar: lodestar.getClient(config, httpClient),
    node: node.getClient(config, httpClient),
    validator: validator.getClient(config, httpClient),
  };
}
