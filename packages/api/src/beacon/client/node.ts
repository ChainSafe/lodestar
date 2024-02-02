import {ChainForkConfig} from "@lodestar/config";
import {ApiClientMethods, IHttpClient, createApiClientMethods} from "../../utils/client/index.js";
import {Endpoints, definitions} from "../routes/node.js";

/**
 * REST HTTP client for beacon routes
 */
export function getClient(_config: ChainForkConfig, httpClient: IHttpClient): ApiClientMethods<Endpoints> {
  return createApiClientMethods(definitions, httpClient);
}
