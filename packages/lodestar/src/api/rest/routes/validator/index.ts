import {IApiModules} from "../../../interface";
import {registerDutiesEndpoint} from "./duties";
import {registerBlockProductionEndpoint} from "./block";

export const validator = (fastify, opts: {prefix: string; modules: IApiModules}, done: Function): void => {
  registerDutiesEndpoint(fastify, opts.modules);
  registerBlockProductionEndpoint(fastify, opts.modules);
  done();
};