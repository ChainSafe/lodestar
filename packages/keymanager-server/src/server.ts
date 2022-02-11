import fastify, {FastifyError, FastifyInstance} from "fastify";
import fastifyCors from "fastify-cors";
import bearerAuthPlugin from "fastify-bearer-auth";
import querystring from "querystring";
import {IncomingMessage} from "http";
import {Api} from "@chainsafe/lodestar-api/keymanager";
import {getRoutes} from "@chainsafe/lodestar-api/keymanager_server";
import {registerRoutesGroup, RouteConfig} from "@chainsafe/lodestar-api/server";
import {ErrorAborted, ILogger} from "@chainsafe/lodestar-utils";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {SecretKey} from "@chainsafe/bls";
import crypto from "crypto";
import {unlink, writeFile} from "fs/promises";
export {allNamespaces} from "@chainsafe/lodestar-api";

// TODO [DA] move to a better location
// Improve the modelling of the type to prevent secretKey.secretKey usage
export type SecretKeyInfo = {
  secretKey: SecretKey;
  keystorePath?: string;
  unlockSecretKeys?: () => void;
};

export type RestApiOptions = {
  host: string;
  cors: string;
  port: number;
  auth: boolean;
  tokenDir?: string;
};

export const restApiOptionsDefault: RestApiOptions = {
  host: "127.0.0.1",
  port: 9597,
  cors: "*",
  auth: true,
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
  private readonly apiTokenPath: string;
  private readonly bearerToken: string;

  constructor(optsArg: Partial<RestApiOptions>, modules: IRestApiModules) {
    // Apply opts defaults
    const opts = {
      ...restApiOptionsDefault,
      ...Object.fromEntries(Object.entries(optsArg).filter(([_, v]) => v != null)),
    };
    if (opts.auth) {
      this.apiTokenPath = `${optsArg.tokenDir}/${apiTokenFileName}`;
      // TODO [DA] I noticed we use some function to generate hex. see if you need to use that here
      this.bearerToken = `api-token-${crypto.randomBytes(32).toString("hex")}`;

      const initToken = async (): Promise<void> => {
        await writeFile(this.apiTokenPath, this.bearerToken, {encoding: "utf8"});
      };

      void initToken();
    } else {
      // TODO [DA] Log a warning
      this.apiTokenPath = "";
      this.bearerToken = "";
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

    if (opts.auth && this.bearerToken !== "") {
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
    this.logger = modules.logger;
  }

  /**
   * Start the REST API server.
   */
  async listen(): Promise<void> {
    try {
      const address = await this.server.listen(this.opts.port, this.opts.host);
      this.logger.info("Started Keymanager api server", {address});
      if (this.opts.auth) {
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
    if (this.opts.auth && this.apiTokenPath !== "") {
      await unlink(this.apiTokenPath);
    }
    await this.server.close();
  }
}
