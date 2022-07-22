import {IChainForkConfig} from "@lodestar/config";
import {} from "../beacon/client/index.js";
import {IHttpClient, HttpClient, HttpClientModules, HttpClientOptions} from "../utils/client/index.js";
import {Api} from "./routes.js";
import * as keymanager from "./client.js";

// NOTE: Don't export server here so it's not bundled to all consumers

export {
  ImportStatus,
  DeletionStatus,
  ImportRemoteKeyStatus,
  DeleteRemoteKeyStatus,
  ResponseStatus,
  SignerDefinition,
  KeystoreStr,
  SlashingProtectionData,
  PubkeyHex,
  Api,
} from "./routes.js";

type ClientModules = HttpClientModules & {
  config: IChainForkConfig;
  httpClient?: IHttpClient;
};

/**
 * REST HTTP client for all keymanager routes
 */
export function getClient(opts: HttpClientOptions, modules: ClientModules): Api {
  const {config} = modules;
  const httpClient = modules.httpClient ?? new HttpClient(opts, modules);

  return keymanager.getClient(config, httpClient);
}
