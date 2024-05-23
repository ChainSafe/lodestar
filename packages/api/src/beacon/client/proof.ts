import {ChainForkConfig} from "@lodestar/config";
import {ApiClientMethods, IHttpClient, createApiClientMethods} from "../../utils/client/index.js";
import {Endpoints, getDefinitions} from "../routes/proof.js";

// TODO: revisit, do we still need to override methods? Make sure we still return same format as previously

export type ApiClient = ApiClientMethods<Endpoints>;

/**
 * REST HTTP client for proof routes
 */
export function getClient(config: ChainForkConfig, httpClient: IHttpClient): ApiClient {
  return createApiClientMethods(getDefinitions(config), httpClient);
}
