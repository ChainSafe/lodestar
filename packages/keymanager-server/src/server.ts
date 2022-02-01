import fastify, {FastifyError, FastifyInstance} from "fastify";
import fastifyCors from "fastify-cors";
import querystring from "querystring";
import {IncomingMessage} from "http";
import {Api} from "@chainsafe/lodestar-api/keymanager";
import {getRoutes} from "@chainsafe/lodestar-api/keymanager_server";
import {registerRoutesGroup, RouteConfig} from "@chainsafe/lodestar-api/server";
import {ErrorAborted, ILogger} from "@chainsafe/lodestar-utils";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {SecretKey} from "@chainsafe/bls";
export {allNamespaces} from "@chainsafe/lodestar-api";

// TODO [DA] move to a better location
// Improve the modelling of the type to prevent secretKey.secretKey usage
export type SecretKeyInfo = {
  secretKey: SecretKey;
  keystorePath?: string;
  keyFile?: string;
  unlockSecretKeys?: () => void;
};

export type RestApiOptions = {
  host: string;
  cors: string;
  port: number;
};

export const restApiOptionsDefault: RestApiOptions = {
  host: "127.0.0.1",
  port: 9597,
  cors: "*",
};

export interface IRestApiModules {
  config: IChainForkConfig;
  logger: ILogger;
  api: Api;
}

export class KeymanagerServer {
  private readonly opts: RestApiOptions;
  private readonly server: FastifyInstance;
  private readonly logger: ILogger;
  private readonly activeRequests = new Set<IncomingMessage>();

  constructor(optsArg: Partial<RestApiOptions>, modules: IRestApiModules) {
    // Apply opts defaults
    const opts = {
      ...restApiOptionsDefault,
      ...Object.fromEntries(Object.entries(optsArg).filter(([_, v]) => v != null)),
    };

    const server = fastify({
      logger: false,
      ajv: {customOptions: {coerceTypes: "array"}},
      querystringParser: querystring.parse,
    });

    // Instantiate and register the keymanager routes
    const routes = getRoutes(modules.config, modules.api);
    registerRoutesGroup(server, routes);

    // To parse our ApiError -> statusCode
    server.setErrorHandler((err, req, res) => {
      if ((err as FastifyError).validation) {
        void res.status(400).send((err as FastifyError).validation);
      } else {
        void res.status(500).send(err);
      }
    });

    if (opts.cors) {
      void server.register(fastifyCors, {origin: opts.cors});
    }

    // Log all incoming request to debug (before parsing). TODO: Should we hook latter in the lifecycle? https://www.fastify.io/docs/latest/Lifecycle/
    // Note: Must be an async method so fastify can continue the release lifecycle. Otherwise we must call done() or the request stalls
    server.addHook("onRequest", async (req) => {
      this.activeRequests.add(req.raw);
      const url = req.raw.url ? req.raw.url.split("?")[0] : "-";
      this.logger.debug(`Req ${req.id} ${req.ip} ${req.raw.method}:${url}`);
    });

    // Log after response
    server.addHook("onResponse", async (req, res) => {
      this.activeRequests.delete(req.raw);
      const {operationId} = res.context.config as RouteConfig;
      this.logger.debug(`Res ${req.id} ${operationId} - ${res.raw.statusCode}`);
    });

    server.addHook("onError", async (req, res, err) => {
      this.activeRequests.delete(req.raw);
      // Don't log ErrorAborted errors, they happen on node shutdown and are not usefull
      if (err instanceof ErrorAborted) return;

      const {operationId} = res.context.config as RouteConfig;
      this.logger.error(`Req ${req.id} ${operationId} error`, {}, err);
    });

    this.opts = opts;
    this.server = server;
    this.logger = modules.logger;
  }

  /**
   * Start the REST API server.
   */
  async listen(): Promise<void> {
    try {
      const address = await this.server.listen(this.opts.port, this.opts.host);
      this.logger.info("Started Keymanager api server", {address});
    } catch (e) {
      this.logger.error(
        "Error starting Keymanager api server",
        {host: this.opts.host, port: this.opts.port},
        e as Error
      );
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
    for (const req of this.activeRequests) {
      req.destroy(Error("Closing"));
    }
    await this.server.close();
  }
}
