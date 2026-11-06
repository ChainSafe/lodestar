import {ApiClientMethods, IHttpClient, createApiClientMethods} from "../utils/client/index.js";
import {Endpoints, getDefinitions} from "./routes.js";

export type ApiClient = ApiClientMethods<Endpoints>;

export function getClient(httpClient: IHttpClient): ApiClient {
  return createApiClientMethods(getDefinitions(), httpClient);
}
