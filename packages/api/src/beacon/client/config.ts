import {ChainForkConfig} from "@lodestar/config";
import {ApiClientMethods, IHttpClient, createApiClientMethods} from "../../utils/client/index.js";
import {Endpoints, definitions} from "../routes/config.js";

export type ApiClient = ApiClientMethods<Endpoints>;

/**
 * REST HTTP client for config routes
 */
export function getClient(_config: ChainForkConfig, httpClient: IHttpClient): ApiClient {
  return createApiClientMethods(definitions, httpClient);
}
