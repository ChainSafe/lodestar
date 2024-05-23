import {ChainForkConfig} from "@lodestar/config";
import {ApiClientMethods, IHttpClient, createApiClientMethods} from "../utils/client/index.js";
import {Endpoints, definitions} from "./routes.js";

export type ApiClient = ApiClientMethods<Endpoints>;

export function getClient(_config: ChainForkConfig, httpClient: IHttpClient): ApiClient {
  return createApiClientMethods(definitions, httpClient);
}
