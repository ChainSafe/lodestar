import * as fastify from "fastify";
import {Service} from "../../node";
import {IRestApiOptions} from "./options";
import {IApiModules} from "../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {ILogger} from "../../logger";
import * as routes from "./routes";
import {IBeaconChain} from "../../chain";
import qs from "qs";
import {ApiNamespace} from "../index";

export interface IFastifyServer extends fastify.FastifyInstance<Server, IncomingMessage, ServerResponse> {
  logger: ILogger;
  chain: IBeaconChain;
}

export class RestApi implements Service {

  public server: IFastifyServer;

  private opts: IRestApiOptions;
  private logger: ILogger;

  public constructor(opts: IRestApiOptions, modules: IApiModules) {
    this.opts = opts;
    this.logger = modules.logger;
    this.server = this.setupServer(modules);
  }

  public async start(): Promise<void> {
    try {
      const address = await this.server.listen(this.opts.port, this.opts.host);
      this.logger.info(`Started rest api server on ${address}`);
    } catch (e) {
      this.logger.error(`Failed to start rest api server on ${this.opts.host}:${this.opts.port}`);
      this.logger.error(e.message);
    }
  }

  public async stop(): Promise<void> {
    await this.server.close();
  }

  private  setupServer(modules: IApiModules): IFastifyServer {
    let server = fastify.default({
      //TODO: somehow pass winston here
      logger: false,
      querystringParser: qs.parse
    }) as IFastifyServer;

    if(this.opts.api.includes(ApiNamespace.BEACON)) {
      server.register(routes.beacon, {prefix: '/node', modules});
    }
    if(this.opts.api.includes(ApiNamespace.VALIDATOR)) {
      server.register(routes.validator, {prefix: '/validator', modules});
    }

    return server;
  }
}