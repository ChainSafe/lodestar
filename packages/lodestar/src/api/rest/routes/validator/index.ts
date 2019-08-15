import {IApiModules} from "../../../interface";
import {registerDutiesEndpoint} from "./duties";

export const validator = (fastify, opts: {prefix: string; modules: IApiModules}, done: Function): void => {
  registerDutiesEndpoint(fastify, opts.modules);
  done();
};