import {HttpClient, HttpClientModules, HttpClientOptions, IHttpClient} from "../utils/client/index.js";
import type {ApiClient} from "./client.js";
import * as signer from "./client.js";

// NOTE: Don't export server here so it's not bundled to all consumers

export type {
  BlockV2Data,
  Deposit,
  Endpoints,
  ForkInfo,
  PubkeyHex,
  SignRequest,
  SignableMessage,
  SyncCommitteeMessage,
} from "./routes.js";
export {SignableMessageType, requiresForkInfo} from "./routes.js";
export type {ApiClient};

type ClientModules = HttpClientModules & {
  httpClient?: IHttpClient;
};

/**
 * REST HTTP client for remote signer routes
 */
export function getClient(opts: HttpClientOptions, modules: ClientModules = {}): ApiClient {
  const httpClient = modules.httpClient ?? new HttpClient(opts, modules);

  return signer.getClient(httpClient);
}
