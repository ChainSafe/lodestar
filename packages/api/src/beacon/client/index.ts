import {ChainForkConfig} from "@lodestar/config";
import {
  IHttpClient,
  HttpClient,
  HttpClientOptions,
  HttpClientModules,
  createApiClientMethods,
  ApiClientMethods,
} from "../../utils/client/index.js";

import {
  Endpoints,
  beacon,
  config as configApi,
  debug,
  lightclient,
  lodestar,
  node,
  proof,
  validator,
} from "../routes/index.js";
import * as events from "./events.js";

type ClientModules = HttpClientModules & {
  config: ChainForkConfig;
  httpClient?: IHttpClient;
};

/**
 * REST HTTP client for all routes
 */
export function getClient(
  opts: HttpClientOptions,
  modules: ClientModules
): {[K in keyof Endpoints]: ApiClientMethods<Endpoints[K]>} {
  const {config} = modules;
  const httpClient = modules.httpClient ?? new HttpClient(opts, modules);

  return {
    beacon: createApiClientMethods(beacon.getDefinitions(config), httpClient),
    config: createApiClientMethods(configApi.definitions, httpClient),
    debug: createApiClientMethods(debug.definitions, httpClient),
    events: events.getClient(httpClient),
    lightclient: createApiClientMethods(lightclient.getDefinitions(config), httpClient),
    lodestar: createApiClientMethods(lodestar.definitions, httpClient),
    node: createApiClientMethods(node.definitions, httpClient),
    proof: createApiClientMethods(proof.definitions, httpClient),
    validator: createApiClientMethods(validator.definitions, httpClient),
  };
}
