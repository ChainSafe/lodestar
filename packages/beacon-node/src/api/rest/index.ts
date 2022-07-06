import {Api} from "@lodestar/api";
import {registerRoutes} from "@lodestar/api/beacon/server";
import {ErrorAborted, ILogger} from "@lodestar/utils";
import {IChainForkConfig} from "@lodestar/config";
import {NodeIsSyncing} from "../impl/errors.js";
import {RestApiServer, RestApiServerModules, RestApiServerMetrics} from "./base.js";
export {allNamespaces} from "@lodestar/api";

export type BeaconRestApiServerOpts = {
  enabled: boolean;
  api: (keyof Api)[];
  port: number;
  cors?: string;
  address?: string;
};

export const beaconRestApiServerOpts: BeaconRestApiServerOpts = {
  enabled: true,
  // ApiNamespace "debug" is not turned on by default
  api: ["beacon", "config", "events", "node", "validator"],
  address: "127.0.0.1",
  port: 9596,
  cors: "*",
};

export type BeaconRestApiServerModules = RestApiServerModules & {
  config: IChainForkConfig;
  logger: ILogger;
  api: Api;
  metrics: RestApiServerMetrics | null;
};

/**
 * REST API powered by `fastify` server.
 */
export class BeaconRestApiServer extends RestApiServer {
  constructor(optsArg: Partial<BeaconRestApiServerOpts>, modules: BeaconRestApiServerModules) {
    const opts = {...beaconRestApiServerOpts, ...optsArg};

    super(opts, modules);

    // Instantiate and register the routes with matching namespace in `opts.api`
    registerRoutes(this.server, modules.config, modules.api, opts.api);
  }

  protected shouldIgnoreError(err: Error): boolean {
    // Don't log ErrorAborted errors, they happen on node shutdown and are not usefull
    // Don't log NodeISSyncing errors, they happen very frequently while syncing and the validator polls duties
    return err instanceof ErrorAborted || err instanceof NodeIsSyncing;
  }
}
