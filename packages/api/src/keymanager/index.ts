import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {HttpClient, HttpClientOptions} from "../client";
import {IHttpClient} from "../client/utils";
import {Api} from "./routes";
import * as keymanager from "./client";

export {ImportStatus, DeletionStatus, KeystoreStr, SlashingProtectionData, PubkeyHex, Api} from "./routes";

/**
 * REST HTTP client for all keymanager routes
 */
export function getClient(config: IChainForkConfig, opts: HttpClientOptions, httpClient?: IHttpClient): Api {
  if (!httpClient) httpClient = new HttpClient(opts);

  return keymanager.getClient(config, httpClient);
}
