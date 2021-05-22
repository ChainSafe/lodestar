import fastify, {FastifyError, FastifyInstance, ServerOptions} from "fastify";
import fastifyCors from "fastify-cors";
import {FastifySSEPlugin} from "fastify-sse-v2";
import {IncomingMessage, Server, ServerResponse} from "http";
import querystring from "querystring";
import {Api} from "@chainsafe/lodestar-api";
import {ErrorAborted, ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IMetrics} from "../../metrics";
import {defaultApiRestOptions, IRestApiOptions} from "./options";
import {registerRoutes} from "./routes";
import {RouteConfig} from "./types";
import {ApiError} from "../impl/errors";

export interface IRestApiModules {
  config: IBeaconConfig;
  logger: ILogger;
  api: Api;
  metrics: IMetrics | null;
}

/**
 * REST API powered by `fastify` server.
 */
export class RestApi {
  private readonly opts: IRestApiOptions;
  private readonly server: FastifyInstance;
  private readonly logger: ILogger;

  constructor(optsArg: Partial<IRestApiOptions>, modules: IRestApiModules) {
    // Apply opts defaults
    const opts = {...defaultApiRestOptions, ...optsArg};

    const server = fastify({
      logger: false,
      ajv: {customOptions: {coerceTypes: "array"}},
      querystringParser: querystring.parse as ServerOptions["querystringParser"],
    });

    server.register(FastifySSEPlugin);

    // Instantiate and register the routes with matching namespace in `opts.api`
    registerRoutes(server, modules.config, modules.api, opts.api);

    // To parse our ApiError -> statusCode
    server.setErrorHandler((err, req, res) => {
      if ((err as FastifyError).validation) {
        res.status(400).send((err as FastifyError).validation);
      } else {
        // Convert our custom ApiError into status code
        const statusCode = err instanceof ApiError ? err.statusCode : 500;
        res.status(statusCode).send(err);
      }
    });

    if (opts.cors) {
      server.register(fastifyCors as fastify.Plugin<Server, IncomingMessage, ServerResponse, Record<string, unknown>>, {
        origin: opts.cors,
      });
    }

    // Log all incoming request to debug (before parsing). TODO: Should we hook latter in the lifecycle? https://www.fastify.io/docs/latest/Lifecycle/
    server.addHook("onRequest", (req) => {
      const url = req.req.url ? req.req.url.split("?")[0] : "-";
      this.logger.debug(`Req ${req.id} ${req.ip} ${req.req.method}:${url}`);
    });

    // Log after response
    server.addHook("onResponse", async (req, res) => {
      const config = res.context.config as RouteConfig;
      this.logger.debug(`Res ${req.id} ${config} - ${res.res.statusCode}`);

      if (modules.metrics) {
        modules.metrics?.apiRestResponseTime.observe({operationId: config.operationId}, res.getResponseTime() / 1000);
      }
    });

    server.addHook("onError", (req, res, err) => {
      // Don't log ErrorAborted errors, they happen on node shutdown and are not usefull
      if (err instanceof ErrorAborted) return;

      const config = res.context.config as RouteConfig;
      this.logger.error(`Req ${req.id} ${config} error`, {}, err);
    });

    this.opts = opts;
    this.server = server;
    this.logger = modules.logger;
  }

  /**
   * Start the REST API server.
   */
  async listen(): Promise<void> {
    // TODO: Consider if necessary. The consumer could just not call this function
    if (!this.opts.enabled) return;

    try {
      const address = await this.server.listen(this.opts.port, this.opts.host);
      this.logger.info("Started REST api server", {address, namespaces: this.opts.api});
    } catch (e) {
      this.logger.error("Error starting REST api server", {host: this.opts.host, port: this.opts.port}, e);
      throw e;
    }
  }

  /**
   * Close the server instance.
   */
  async close(): Promise<void> {
    await this.server.close();
  }
}
