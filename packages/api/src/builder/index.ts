import {ChainForkConfig} from "@lodestar/config";
import {
  HttpClient,
  HttpClientModules,
  HttpClientOptions,
  IHttpClient,
  ApiWithExtraOpts,
} from "../utils/client/index.js";
import {Api as BuilderApi} from "../builder/routes.js";
import * as builder from "./client.js";

// NOTE: Don't export server here so it's not bundled to all consumers

// Note: build API does not have namespaces as routes are declared at the "root" namespace

export type Api = ApiWithExtraOpts<BuilderApi>;
type ClientModules = HttpClientModules & {
  config: ChainForkConfig;
  httpClient?: IHttpClient;
};

export function getClient(opts: HttpClientOptions, modules: ClientModules): Api {
  const {config} = modules;
  const httpClient = modules.httpClient ?? new HttpClient(opts, modules);

  return builder.getClient(config, httpClient);
}
