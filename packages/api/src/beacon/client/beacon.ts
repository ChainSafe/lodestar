import {ChainForkConfig} from "@lodestar/config";
import {ApiClientMethods, IHttpClient, createApiClientMethods} from "../../utils/client/index.js";
import {Endpoints, getDefinitions} from "../routes/beacon/index.js";

/**
 * REST HTTP client for beacon routes
 */
export function getClient(config: ChainForkConfig, httpClient: IHttpClient): ApiClientMethods<Endpoints> {
  return createApiClientMethods(getDefinitions(config), httpClient);
}
