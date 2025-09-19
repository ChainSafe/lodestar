import {ChainForkConfig} from "@lodestar/config";
import {HttpClient, HttpClientModules, HttpClientOptions, IHttpClient} from "../utils/client/index.js";
import type {ApiClient} from "./client.js";
import * as keymanager from "./client.js";

// NOTE: Don't export server here so it's not bundled to all consumers

export type {
  BuilderBoostFactorData,
  Endpoints,
  FeeRecipientData,
  GasLimitData,
  GraffitiData,
  KeystoreStr,
  ProposerConfigResponse,
  PubkeyHex,
  RemoteSignerDefinition,
  ResponseStatus,
  SignerDefinition,
  SlashingProtectionData,
} from "./routes.js";
export {DeleteRemoteKeyStatus, DeletionStatus, ImportRemoteKeyStatus, ImportStatus} from "./routes.js";

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
