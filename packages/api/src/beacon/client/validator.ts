import {ChainForkConfig} from "@lodestar/config";
import {ApiClientMethods, IHttpClient, createApiClientMethods} from "../../utils/client/index.js";
import {Endpoints, definitions} from "../routes/validator.js";

/**
 * REST HTTP client for validator routes
 */
export function getClient(_config: ChainForkConfig, httpClient: IHttpClient): ApiClientMethods<Endpoints> {
  return createApiClientMethods(definitions, httpClient);
}
