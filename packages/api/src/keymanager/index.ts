import {ChainForkConfig} from "@lodestar/config";
import {} from "../beacon/client/index.js";
import {
  IHttpClient,
  HttpClient,
  HttpClientModules,
  HttpClientOptions,
  ApiClientMethods,
} from "../utils/client/index.js";
import {Endpoints} from "./routes.js";
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
  EthAddress,
  Graffiti,
} from "./routes.js";

type ClientModules = HttpClientModules & {
  config: ChainForkConfig;
  httpClient?: IHttpClient;
};

/**
 * REST HTTP client for keymanager routes
 */
export function getClient(opts: HttpClientOptions, modules: ClientModules): ApiClientMethods<Endpoints> {
  const {config} = modules;
  const httpClient = modules.httpClient ?? new HttpClient(opts, modules);

  return keymanager.getClient(config, httpClient);
}
