import qs from "qs";
import fastify, {FastifyError, FastifyInstance} from "fastify";
import fastifyCors from "fastify-cors";
import bearerAuthPlugin from "fastify-bearer-auth";
import {RouteConfig} from "@lodestar/api/beacon/server";
import {ErrorAborted, Logger} from "@lodestar/utils";
import {isLocalhostIP} from "../../util/ip.js";
import {IGauge, IHistogram} from "../../metrics/index.js";
import {ApiError, NodeIsSyncing} from "../impl/errors.js";
import {HttpActiveSocketsTracker, SocketMetrics} from "./activeSockets.js";

export type RestApiServerOpts = {
  port: number;
  cors?: string;
  address?: string;
  bearerToken?: string;
  bodyLimit?: number;
};

export type RestApiServerModules = {
  logger: Logger;
  metrics: RestApiServerMetrics | null;
};

export type RestApiServerMetrics = SocketMetrics & {
  requests: IGauge<"operationId">;
  responseTime: IHistogram<"operationId">;
  errors: IGauge<"operationId">;
};

/**
 * REST API powered by `fastify` server.
 */
export class RestApiServer {
  protected readonly server: FastifyInstance;
  protected readonly logger: Logger;
  private readonly activeSockets: HttpActiveSocketsTracker;

  constructor(private readonly opts: RestApiServerOpts, modules: RestApiServerModules) {
    // Apply opts defaults
    const {logger, metrics} = modules;

    const server = fastify({
      logger: false,
      ajv: {customOptions: {coerceTypes: "array"}},
      querystringParser: (str) =>
        qs.parse(str, {
          // defaults to 20 but Beacon API spec allows max items of 30
          arrayLimit: 30,
          // array as comma-separated values must be supported to be OpenAPI spec compliant
          comma: true,
          // default limit of 1000 seems unnecessarily high, let's reduce it a bit
          parameterLimit: 100,
        }),
      bodyLimit: opts.bodyLimit,
    });

    this.activeSockets = new HttpActiveSocketsTracker(server.server, metrics);

    // To parse our ApiError -> statusCode
    server.setErrorHandler((err, req, res) => {
      if ((err as FastifyError).validation) {
        void res.status(400).send((err as FastifyError).validation);
      } else {
        // Convert our custom ApiError into status code
        const statusCode = err instanceof ApiError ? err.statusCode : 500;
        void res.status(statusCode).send(err);
      }
    });

    if (opts.cors) {
      void server.register(fastifyCors, {origin: opts.cors});
    }

    if (opts.bearerToken) {
      void server.register(bearerAuthPlugin, {keys: new Set([opts.bearerToken])});
    }

    // Log all incoming request to debug (before parsing). TODO: Should we hook latter in the lifecycle? https://www.fastify.io/docs/latest/Lifecycle/
    // Note: Must be an async method so fastify can continue the release lifecycle. Otherwise we must call done() or the request stalls
    server.addHook("onRequest", async (req, res) => {
      const {operationId} = res.context.config as RouteConfig;
      this.logger.debug(`Req ${req.id} ${req.ip} ${operationId}`);
      metrics?.requests.inc({operationId});
    });

    // Log after response
    server.addHook("onResponse", async (req, res) => {
      const {operationId} = res.context.config as RouteConfig;
      this.logger.debug(`Res ${req.id} ${operationId} - ${res.raw.statusCode}`);
      metrics?.responseTime.observe({operationId}, res.getResponseTime() / 1000);
    });

    server.addHook("onError", async (req, res, err) => {
      // Don't log ErrorAborted errors, they happen on node shutdown and are not useful
      // Don't log NodeISSyncing errors, they happen very frequently while syncing and the validator polls duties
      if (err instanceof ErrorAborted || err instanceof NodeIsSyncing) return;

      const {operationId} = res.context.config as RouteConfig;
      this.logger.error(`Req ${req.id} ${operationId} error`, {}, err);
      metrics?.errors.inc({operationId});
    });

    this.server = server;
    this.logger = logger;
  }

  /**
   * Start the REST API server.
   */
  async listen(): Promise<void> {
    try {
      const host = this.opts.address;
      const address = await this.server.listen(this.opts.port, host);
      this.logger.info("Started REST API server", {address});
      if (!host || !isLocalhostIP(host)) {
        this.logger.warn("REST API server is exposed, ensure untrusted traffic cannot reach this API");
      }
    } catch (e) {
      this.logger.error("Error starting REST api server", this.opts, e as Error);
      throw e;
    }
  }

  /**
   * Close the server instance and terminate all existing connections.
   */
  async close(): Promise<void> {
    // In NodeJS land calling close() only causes new connections to be rejected.
    // Existing connections can prevent .close() from resolving for potentially forever.
    // In Lodestar case when the BeaconNode wants to close we will just abruptly terminate
    // all existing connections for a fast shutdown.
    // Inspired by https://github.com/gajus/http-terminator/
    this.activeSockets.destroyAll();

    await this.server.close();
  }

  /** For child classes to override */
  protected shouldIgnoreError(_err: Error): boolean {
    return false;
  }
}
