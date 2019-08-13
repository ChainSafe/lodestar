import * as fastify from "fastify";
import {Service} from "../../node";
import {IRestApiOptions} from "./options";
import {IApiModules} from "../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {ILogger} from "../../logger";
import * as routes from "./routes";

export type FastifyServer = fastify.FastifyInstance<Server, IncomingMessage, ServerResponse>

export class RestApi implements Service {

  public server: FastifyServer;

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

  private  setupServer(modules: IApiModules): FastifyServer {
    const server = fastify.default({
      //TODO: somehow pass winston here
      logger: false
    });

    server.register((fastify, opts, done) => {
      fastify.decorate('logger', modules.logger);
      done();
    });

    server.register(routes.beacon, {prefix: '/node'});

    return server;
  }
}