import * as fastify from "fastify";
import fastifyCors from "fastify-cors";
import {IService} from "../../node";
import {IRestApiOptions} from "./options";
import {IApiModules} from "../interface";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import * as routes from "./routes";
import qs from "qs";
import {ApiNamespace} from "../index";
import {BeaconApi} from "../impl/beacon";
import {ValidatorApi} from "../impl/validator";
import {FastifyInstance} from "fastify";
import {applySyncingMiddleware} from "./middleware/syncing";

export class RestApi implements IService {

  public server: FastifyInstance;

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

  private  setupServer(modules: IApiModules): FastifyInstance {
    const server = fastify.default({
      //TODO: somehow pass winston here
      logger: false,
      querystringParser: qs.parse
    });

    if(this.opts.cors) {
      const corsArr = this.opts.cors.split(",");
      server.register(fastifyCors, {
        origin: corsArr
      });
    }
    const beacon = new BeaconApi({}, modules);
    const validator = new ValidatorApi({}, modules);
    if(this.opts.api.includes(ApiNamespace.BEACON)) {
      server.register(routes.beacon, {prefix: "/node", api: {beacon, validator}, config: modules.config});
    }
    if(this.opts.api.includes(ApiNamespace.VALIDATOR)) {
      applySyncingMiddleware(server, "/validator/*", modules);
      server.register(routes.validator, {prefix: "/validator", api: {beacon, validator}, config: modules.config});
    }

    return server;
  }
}