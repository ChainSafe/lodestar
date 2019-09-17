import {registerVersionEndpoint} from "./version";
import {registerGenesisTimeEndpoint} from "./genesisTime";
import {IApiModules} from "../../../interface";
import {registerSyncingEndpoint} from "./syncing";
import {IFastifyServer} from "../../index";

export const beacon = (fastify: IFastifyServer, opts: {prefix: string; modules: IApiModules}, done: Function): void => {
  registerVersionEndpoint(fastify, opts.modules);
  registerGenesisTimeEndpoint(fastify, opts.modules);
  registerSyncingEndpoint(fastify, opts.modules);
  done();
};