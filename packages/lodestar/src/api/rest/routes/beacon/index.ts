import {registerVersionEndpoint} from "./version";
import {registerGenesisTimeEndpoint} from "./genesisTime";
import {IApiModules} from "../../../interface";
import {registerSyncingeEndpoint} from "./syncing";

export const beacon = (fastify, opts: {prefix: string; modules: IApiModules}, done: Function): void => {
  registerVersionEndpoint(fastify, opts.modules);
  registerGenesisTimeEndpoint(fastify, opts.modules);
  registerSyncingeEndpoint(fastify, opts.modules);
  done();
};