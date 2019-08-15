import {IApiModules} from "../../../interface";
import {registerDutiesEndpoint} from "./duties";
import {registerBlockProductionEndpoint} from "./produceBlock";
import {registerBlockPublishEndpoint} from "./publishBlock";

export const validator = (fastify, opts: {prefix: string; modules: IApiModules}, done: Function): void => {
  registerDutiesEndpoint(fastify, opts.modules);
  registerBlockProductionEndpoint(fastify, opts.modules);
  registerBlockPublishEndpoint(fastify, opts.modules);
  done();
};