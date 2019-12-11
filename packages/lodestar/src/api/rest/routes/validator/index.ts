import {IApiModules} from "../../../interface";
import {registerBlockProductionEndpoint} from "./produceBlock";
import {registerBlockPublishEndpoint} from "./publishBlock";
import {registerAttestationProductionEndpoint} from "./produceAttestation";
import {registerAttestationPublishEndpoint} from "./publishAttestation";
import {registerSyncingMiddleware} from "./syncing";
import {IFastifyServer} from "../../index";
import {registerProposerDutiesEndpoint} from "./duties/proposer";
import {registerAttesterDutiesEndpoint} from "./duties/attester";

export const validator =
    (fastify: IFastifyServer, opts: {prefix: string; modules: IApiModules}, done: Function): void => {
      registerProposerDutiesEndpoint(fastify, opts.modules);
      registerAttesterDutiesEndpoint(fastify, opts.modules);
      registerBlockProductionEndpoint(fastify, opts.modules);
      registerBlockPublishEndpoint(fastify, opts.modules);
      registerAttestationProductionEndpoint(fastify, opts.modules);
      registerAttestationPublishEndpoint(fastify, opts.modules);
      registerSyncingMiddleware(fastify, opts.modules);
      done();
    };