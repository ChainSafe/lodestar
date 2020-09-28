import "fastify";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IApi} from "../../src/api/impl";

declare module "fastify" {
  // eslint-disable-next-line @typescript-eslint/interface-name-prefix
  interface FastifyInstance<HttpServer, HttpRequest, HttpResponse, Config = {}> {
    //decorated properties on fastify server
    config: IBeaconConfig;
    api: IApi;
  }
}
