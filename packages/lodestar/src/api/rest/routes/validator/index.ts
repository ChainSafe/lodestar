import {IApiModules} from "../../../interface";
import {registerDutiesEndpoint} from "./duties";
import {registerBlockProductionEndpoint} from "./produceBlock";
import {registerBlockPublishEndpoint} from "./publishBlock";
import {registerAttestationProductionEndpoint} from "./produceAttestation";
import {registerAttestationPublishEndpoint} from "./publishAttestation";

export const validator = (fastify, opts: {prefix: string; modules: IApiModules}, done: Function): void => {
  registerDutiesEndpoint(fastify, opts.modules);
  registerBlockProductionEndpoint(fastify, opts.modules);
  registerBlockPublishEndpoint(fastify, opts.modules);
  registerAttestationProductionEndpoint(fastify, opts.modules);
  registerAttestationPublishEndpoint(fastify, opts.modules);
  done();
};