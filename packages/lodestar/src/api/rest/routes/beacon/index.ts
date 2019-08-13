import {FastifyServer} from "../../index";
import {registerVersionEndpoint} from "./version";

export const beacon = (fastify: FastifyServer, opts: {}, done: Function): void => {
  registerVersionEndpoint(fastify);
  done();
};