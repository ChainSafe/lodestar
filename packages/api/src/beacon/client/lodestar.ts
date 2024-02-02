import {ChainForkConfig} from "@lodestar/config";
import {ApiClientMethods, IHttpClient, createApiClientMethods} from "../../utils/client/index.js";
import {Endpoints, definitions} from "../routes/lodestar.js";

/**
 * REST HTTP client for lodestar routes
 */
export function getClient(_config: ChainForkConfig, httpClient: IHttpClient): ApiClientMethods<Endpoints> {
  return createApiClientMethods(definitions, httpClient);
}
