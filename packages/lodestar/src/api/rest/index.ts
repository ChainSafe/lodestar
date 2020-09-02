import fastify, {FastifyInstance} from "fastify";
import fastifyCors from "fastify-cors";
import {IService} from "../../node";
import {IRestApiOptions} from "./options";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import * as routes from "./routes";
import {registerRoutes} from "./routes";
import {ApiNamespace} from "../index";
import {IRestApiModules} from "./interface";
import {FastifySSEPlugin} from "fastify-sse-v2";
import * as querystring from "querystring";
import {FastifyLogger} from "./logger/fastify";
import {errorHandler} from "./routes/error";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IValidatorApi} from "../impl/validator";
import {IBeaconApi} from "../impl/beacon";
import {INodeApi} from "../impl/node";
import {IncomingMessage, Server, ServerResponse} from "http";

export class RestApi implements IService {
  public server: FastifyInstance;

  private opts: IRestApiOptions;
  private logger: ILogger;

  public constructor(opts: IRestApiOptions, modules: IRestApiModules) {
    this.opts = opts;
    this.logger = modules.logger;
    this.server = this.setupServer(modules);
  }

  public async start(): Promise<void> {
    try {
      const address = await this.server.listen(this.opts.port, this.opts.host);
      this.logger.info(`Started rest api server on ${address}`);
    } catch (e) {
      this.logger.error(`Failed to start rest api server on ${this.opts.host}:${this.opts.port}`, e);
      throw e;
    }
  }

  public async stop(): Promise<void> {
    await this.server.close();
  }

  private setupServer(modules: IRestApiModules): FastifyInstance {
    const server = fastify({
      logger: new FastifyLogger(this.logger),
      ajv: {
        customOptions: {
          coerceTypes: "array",
        },
      },
      querystringParser: querystring.parse,
    });
    server.setErrorHandler(errorHandler);
    if (this.opts.cors) {
      server.register(fastifyCors as fastify.Plugin<Server, IncomingMessage, ServerResponse, {}>, {
        origin: this.opts.cors,
      });
    }
    server.register(FastifySSEPlugin);
    const api = {
      beacon: modules.beacon,
      node: modules.node,
      validator: modules.validator,
    };
    server.decorate("config", modules.config);
    server.decorate("api", api);
    //new api
    const enabledApiNamespaces = this.opts.api;
    server.register(async function (instance) {
      registerRoutes(instance, enabledApiNamespaces);
    });

    //old api, remove once migrated
    if (enabledApiNamespaces.includes(ApiNamespace.BEACON)) {
      server.register(routes.beacon, {prefix: "/lodestar", api, config: modules.config});
    }
    if (enabledApiNamespaces.includes(ApiNamespace.VALIDATOR)) {
      //TODO: enable when syncing status api working
      // applySyncingMiddleware(server, "/validator/*", modules);
      server.register(routes.validator, {prefix: "/validator", api, config: modules.config});
    }

    return server;
  }
}

declare module "fastify" {
  // eslint-disable-next-line @typescript-eslint/interface-name-prefix
  interface FastifyInstance<HttpServer, HttpRequest, HttpResponse, Config = {}> {
    //decorated properties on fastify server
    config: IBeaconConfig;
    api: {
      beacon: IBeaconApi;
      node: INodeApi;
      validator: IValidatorApi;
    };
  }
}
