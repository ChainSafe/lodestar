import {ChainForkConfig} from "@lodestar/config";
import {ApiClientMethods, IHttpClient, createApiClientMethods} from "../utils/client/index.js";
import {Endpoints, getDefinitions} from "./routes.js";

/**
 * REST HTTP client for builder routes
 */
export function getClient(config: ChainForkConfig, httpClient: IHttpClient): ApiClientMethods<Endpoints> {
  return createApiClientMethods(getDefinitions(config), httpClient);
}
