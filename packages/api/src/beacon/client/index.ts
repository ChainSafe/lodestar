import {IChainForkConfig} from "@lodestar/config";
import {Api} from "../routes/index.js";
import {
  IHttpClient,
  HttpClient,
  HttpClientOptions,
  HttpClientModules,
  ClientOptions,
} from "../../utils/client/index.js";

import * as beacon from "./beacon.js";
import * as configApi from "./config.js";
import * as debug from "./debug.js";
import * as events from "./events.js";
import * as lightclient from "./lightclient.js";
import * as lodestar from "./lodestar.js";
import * as node from "./node.js";
import * as proof from "./proof.js";
import * as validator from "./validator.js";

type ClientModules = HttpClientModules & {
  config: IChainForkConfig;
  httpClient?: IHttpClient;
};

export const defaultClientOptions: ClientOptions<false> = {
  errorAsResponse: false,
};

/**
 * REST HTTP client for all routes
 */
export function getClient<ErrorAsResponse extends boolean = false>(
  opts: HttpClientOptions,
  modules: ClientModules,
  options?: ClientOptions<ErrorAsResponse>
): Api<ErrorAsResponse> {
  const {config} = modules;
  const httpClient = modules.httpClient ?? new HttpClient(opts, modules);

  return {
    beacon: beacon.getClient<ErrorAsResponse>(config, httpClient, options),
    config: configApi.getClient<ErrorAsResponse>(config, httpClient, options),
    debug: debug.getClient<ErrorAsResponse>(config, httpClient, options),
    events: events.getClient(config, httpClient.baseUrl),
    lightclient: lightclient.getClient<ErrorAsResponse>(config, httpClient, options),
    lodestar: lodestar.getClient<ErrorAsResponse>(config, httpClient, options),
    node: node.getClient<ErrorAsResponse>(config, httpClient, options),
    proof: proof.getClient<ErrorAsResponse>(config, httpClient, options),
    validator: validator.getClient<ErrorAsResponse>(config, httpClient, options),
  };
}
