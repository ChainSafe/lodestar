import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {HttpClient, HttpClientOptions} from "../client/index.js";
import {IHttpClient} from "../client/utils/index.js";
import {Api} from "./routes.js";
import * as keymanager from "./client.js";

export {ImportStatus, DeletionStatus, KeystoreStr, SlashingProtectionData, PubkeyHex, Api} from "./routes.js";

/**
 * REST HTTP client for all keymanager routes
 */
export function getClient(config: IChainForkConfig, opts: HttpClientOptions, httpClient?: IHttpClient): Api {
  if (!httpClient) httpClient = new HttpClient(opts);

  return keymanager.getClient(config, httpClient);
}
