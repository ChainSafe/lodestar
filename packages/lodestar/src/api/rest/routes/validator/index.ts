import {FastifyInstance} from "fastify";
import {attesterDutiesController} from "../../controllers/validator/duties/attesterDuties";
import {LodestarApiPlugin} from "../../interface";
import {registerProposerDutiesEndpoint} from "./duties/proposer";
import {registerGetWireAttestationEndpoint} from "./getWireAttestations";
import {registerAggregateAndProofProductionEndpoint} from "./produceAggregatedAttestation";
import {registerAttestationProductionEndpoint} from "./produceAttestation";
import {registerPublishAggregateAndProofEndpoint} from "./publishAggregateAndProof";
import {registerAttestationPublishEndpoint} from "./publishAttestation";
import {registerSubscribeToCommitteeSubnet} from "./subscribeToCommitteeSubnet";
import {produceBlockController} from "../../controllers/validator";

//old
export const validator: LodestarApiPlugin = (fastify, opts, callback): void => {
  registerProposerDutiesEndpoint(fastify, opts);
  registerPublishAggregateAndProofEndpoint(fastify, opts);
  registerAttestationProductionEndpoint(fastify, opts);
  registerAttestationPublishEndpoint(fastify, opts);
  registerSubscribeToCommitteeSubnet(fastify, opts);
  registerGetWireAttestationEndpoint(fastify, opts);
  registerAggregateAndProofProductionEndpoint(fastify, opts);
  callback();
};

//new
export function registerValidatorRoutes(server: FastifyInstance): void {
  server.register(
    async function (fastify) {
      fastify.post(attesterDutiesController.url, attesterDutiesController.opts, attesterDutiesController.handler);
      fastify.get(produceBlockController.url, produceBlockController.opts, produceBlockController.handler);
    },
    {prefix: "/v1/validator"}
  );
}
