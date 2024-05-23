import {ChainForkConfig} from "@lodestar/config";
import {ApiClientMethods, createApiClientMethods, IHttpClient} from "../../utils/client/index.js";
import {definitions, Endpoints} from "../routes/debug.js";

// As Jul 2022, it takes up to 3 mins to download states so make this 5 mins for reservation
const GET_STATE_TIMEOUT_MS = 5 * 60 * 1000;

export type ApiClient = ApiClientMethods<Endpoints>;

/**
 * REST HTTP client for debug routes
 */
export function getClient(_config: ChainForkConfig, httpClient: IHttpClient): ApiClient {
  const client = createApiClientMethods(definitions, httpClient);

  return {
    ...client,
    getState(args, init) {
      return client.getState(args, {timeoutMs: GET_STATE_TIMEOUT_MS, ...init});
    },
    getStateV2(args, init) {
      return client.getStateV2(args, {timeoutMs: GET_STATE_TIMEOUT_MS, ...init});
    },
  };
}
