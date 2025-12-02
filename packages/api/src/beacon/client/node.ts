import {ChainForkConfig} from "@lodestar/config";
import {ApiClientMethods, IHttpClient, createApiClientMethods} from "../../utils/client/index.js";
import {Endpoints, getDefinitions} from "../routes/node.js";

export type ApiClient = ApiClientMethods<Endpoints>;

/**
 * REST HTTP client for beacon routes
 */
export function getClient(config: ChainForkConfig, httpClient: IHttpClient): ApiClient {
  return createApiClientMethods(getDefinitions(config), httpClient);
}
