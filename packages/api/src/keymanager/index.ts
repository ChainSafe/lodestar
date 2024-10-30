import {ChainForkConfig} from "@lodestar/config";
import {HttpClient, HttpClientModules, HttpClientOptions, IHttpClient} from "../utils/client/index.js";
import type {ApiClient} from "./client.js";
import * as keymanager from "./client.js";

// NOTE: Don't export server here so it's not bundled to all consumers

export {ImportStatus, DeletionStatus, ImportRemoteKeyStatus, DeleteRemoteKeyStatus} from "./routes.js";
export type {
  ResponseStatus,
  SignerDefinition,
  RemoteSignerDefinition,
  KeystoreStr,
  SlashingProtectionData,
  PubkeyHex,
  Endpoints,
  FeeRecipientData,
  GraffitiData,
  GasLimitData,
  BuilderBoostFactorData,
  ProposerConfigResponse,
} from "./routes.js";

export type {ApiClient};

type ClientModules = HttpClientModules & {
  config: ChainForkConfig;
  httpClient?: IHttpClient;
};

/**
 * REST HTTP client for keymanager routes
 */
export function getClient(opts: HttpClientOptions, modules: ClientModules): ApiClient {
  const {config} = modules;
  const httpClient = modules.httpClient ?? new HttpClient(opts, modules);

  return keymanager.getClient(config, httpClient);
}
