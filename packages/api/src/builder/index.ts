import {ChainForkConfig} from "@lodestar/config";
import {HttpClient, HttpClientModules, HttpClientOptions, IHttpClient} from "../utils/client/httpClient.js";
import {ApiClientMethods} from "../utils/client/method.js";
import * as builder from "./client.js";
import {Endpoints} from "./routes.js";

// NOTE: Don't export server here so it's not bundled to all consumers

export type {Endpoints};

// Note: build API does not have namespaces as routes are declared at the "root" namespace

type ClientModules = HttpClientModules & {
  config: ChainForkConfig;
  httpClient?: IHttpClient;
};

export function getClient(opts: HttpClientOptions, modules: ClientModules): ApiClientMethods<Endpoints> {
  const {config} = modules;
  const httpClient = modules.httpClient ?? new HttpClient(opts, modules);

  return builder.getClient(config, httpClient);
}
