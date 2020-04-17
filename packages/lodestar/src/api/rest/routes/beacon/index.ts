import {registerVersionEndpoint} from "./version";
import {registerGenesisTimeEndpoint} from "./genesisTime";
import {registerForkEndpoint} from "./fork";
import {registerSyncingEndpoint} from "./syncing";
import {LodestarApiPlugin} from "../../interface";
import {registerBlockStreamEndpoint} from "./blockStream";
import {registerGetValidatorEndpoint} from "./validator";

export const beacon: LodestarApiPlugin = (fastify, opts, done: Function): void => {
  registerVersionEndpoint(fastify, opts);
  registerGenesisTimeEndpoint(fastify, opts);
  registerForkEndpoint(fastify, opts);
  registerSyncingEndpoint(fastify, opts);
  registerGetValidatorEndpoint(fastify, opts);
  registerBlockStreamEndpoint(fastify, opts);
  done();
};