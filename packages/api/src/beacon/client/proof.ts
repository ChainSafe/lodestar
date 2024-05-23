import {ChainForkConfig} from "@lodestar/config";
import {ApiClientMethods, IHttpClient, createApiClientMethods} from "../../utils/client/index.js";
import {Endpoints, definitions} from "../routes/proof.js";

// TODO: revisit, do we still need to override methods? Make sure we still return same format as previously

export type ApiClient = ApiClientMethods<Endpoints>;

/**
 * REST HTTP client for proof routes
 */
export function getClient(_config: ChainForkConfig, httpClient: IHttpClient): ApiClient {
  return createApiClientMethods(definitions, httpClient);
}
