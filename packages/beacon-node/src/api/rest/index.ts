import {Endpoints} from "@lodestar/api";
import {BeaconApiMethods} from "@lodestar/api/beacon/server";
import {registerRoutes} from "@lodestar/api/beacon/server";
import {ErrorAborted, Logger} from "@lodestar/utils";
import {ChainForkConfig} from "@lodestar/config";
import {NodeIsSyncing} from "../impl/errors.js";
import {RestApiServer, RestApiServerModules, RestApiServerMetrics, RestApiServerOpts} from "./base.js";
import {registerSwaggerUIRoutes} from "./swaggerUI.js";

export {allNamespaces} from "@lodestar/api";

export type BeaconRestApiServerOpts = Omit<RestApiServerOpts, "bearerToken"> & {
  enabled: boolean;
  api: (keyof Endpoints)[];
};

export const beaconRestApiServerOpts: BeaconRestApiServerOpts = {
  enabled: true,
  api: ["beacon", "config", "debug", "events", "node", "validator", "lightclient"],
  address: "127.0.0.1",
  port: 9596,
  cors: "*",
  // beacon -> validator API is trusted, and for large amounts of keys the payload is multi-MB
  bodyLimit: 20 * 1024 * 1024, // 20MB for big block + blobs
  stacktraces: false,
};

export type BeaconRestApiServerModules = RestApiServerModules & {
  config: ChainForkConfig;
  logger: Logger;
  api: BeaconApiMethods;
  metrics: RestApiServerMetrics | null;
};

/**
 * REST API powered by `fastify` server.
 */
export class BeaconRestApiServer extends RestApiServer {
  readonly opts: BeaconRestApiServerOpts;
  readonly modules: BeaconRestApiServerModules;

  constructor(optsArg: Partial<BeaconRestApiServerOpts>, modules: BeaconRestApiServerModules) {
    const opts = {...beaconRestApiServerOpts, ...optsArg};

    super(opts, modules);

    this.opts = opts;
    this.modules = modules;
  }

  async registerRoutes(version?: string): Promise<void> {
    if (this.opts.swaggerUI) {
      await registerSwaggerUIRoutes(this.server, this.opts, version);
    }
    // Instantiate and register the routes with matching namespace in `opts.api`
    registerRoutes(this.server, this.modules.config, this.modules.api, this.opts.api);
  }

  protected shouldIgnoreError(err: Error): boolean {
    // Don't log ErrorAborted errors, they happen on node shutdown and are not useful
    // Don't log NodeISSyncing errors, they happen very frequently while syncing and the validator polls duties
    return err instanceof ErrorAborted || err instanceof NodeIsSyncing;
  }
}
