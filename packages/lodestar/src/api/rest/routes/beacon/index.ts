import {registerVersionEndpoint} from "./version";
import {registerGenesisTimeEndpoint} from "./genesisTime";
import {registerForkEndpoint} from "./fork";
import {IApiModules} from "../../../interface";
import {registerSyncingEndpoint} from "./syncing";
import {IFastifyServer} from "../../index";

export const beacon = (fastify: IFastifyServer, opts: {prefix: string; modules: IApiModules}, done: Function): void => {
  registerVersionEndpoint(fastify);
  registerGenesisTimeEndpoint(fastify, opts.modules);
  registerForkEndpoint(fastify, opts.modules);
  registerSyncingEndpoint(fastify, opts.modules);
  done();
};