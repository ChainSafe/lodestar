import fastify, {FastifyError, FastifyInstance} from "fastify";
import fastifyCors from "fastify-cors";
import bearerAuthPlugin from "fastify-bearer-auth";
import querystring from "querystring";
import {IncomingMessage} from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import {toHexString} from "@chainsafe/ssz";
export {allNamespaces} from "@chainsafe/lodestar-api";
import {Api} from "@chainsafe/lodestar-api/keymanager";
import {getRoutes} from "@chainsafe/lodestar-api/keymanager/server";
import {registerRoutesGroup, RouteConfig} from "@chainsafe/lodestar-api/server";
import {ErrorAborted, ILogger} from "@chainsafe/lodestar-utils";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {join} from "node:path";

export type RestApiOptions = {
  host: string;
  cors: string;
  port: number;
  isAuthEnabled: boolean;
  tokenDir?: string;
};

export const restApiOptionsDefault: RestApiOptions = {
  host: "127.0.0.1",
  port: 5062,
  cors: "*",
  isAuthEnabled: true,
};

export interface IRestApiModules {
  config: IChainForkConfig;
  logger: ILogger;
  api: Api;
}

const apiTokenFileName = "api-token.txt";

export class KeymanagerServer {
  private readonly opts: RestApiOptions;
  private readonly server: FastifyInstance;
  private readonly logger: ILogger;
  private readonly activeRequests = new Set<IncomingMessage>();
  private readonly apiTokenPath: string | undefined;
  private readonly bearerToken: string | undefined;

  constructor(optsArg: Partial<RestApiOptions>, modules: IRestApiModules) {
    this.logger = modules.logger;

    // Apply opts defaults
    const opts = {
      ...restApiOptionsDefault,
      // optsArg is a Partial type, any of its properties can be undefined. If port is set to undefined,
      // it overrides the default port value in restApiOptionsDefault to be undefined.
      ...Object.fromEntries(Object.entries(optsArg).filter(([_, v]) => v != null)),
    };

    if (opts.isAuthEnabled && opts.tokenDir) {
      this.apiTokenPath = join(opts.tokenDir, apiTokenFileName);
      // Generate a new token if token file does not exist or file do exist, but is empty
      if (!fs.existsSync(this.apiTokenPath) || fs.readFileSync(this.apiTokenPath, "utf8").trim().length === 0) {
        this.bearerToken = `api-token-${toHexString(crypto.randomBytes(32))}`;
        fs.writeFileSync(this.apiTokenPath, this.bearerToken, {encoding: "utf8"});
      } else {
        this.bearerToken = fs.readFileSync(this.apiTokenPath, "utf8").trim();
      }
    } else {
      this.logger.warn("Keymanager server started without authentication");
    }

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

    if (opts.isAuthEnabled && this.bearerToken) {
      void server.register(bearerAuthPlugin, {keys: new Set([this.bearerToken])});
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
  }

  /**
   * Start the REST API server.
   */
  async listen(): Promise<void> {
    try {
      const address = await this.server.listen(this.opts.port, this.opts.host);
      this.logger.info("Started keymanager api server", {address});
      if (this.apiTokenPath) {
        this.logger.info("Keymanager bearer access token located at:", this.apiTokenPath);
      }
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
