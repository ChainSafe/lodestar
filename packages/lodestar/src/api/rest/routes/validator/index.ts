import {FastifyInstance} from "fastify";
import {
  attesterDutiesController,
  produceAggregatedAttestation,
  produceAttestationData,
  proposerDutiesController,
  publishAggregateAndProof,
  produceBlockController,
} from "../../controllers/validator";
import {prepareCommitteeSubnet} from "../../controllers/validator/prepareCommitteeSubnet";
import {LodestarApiPlugin} from "../../interface";

//old
export const validator: LodestarApiPlugin = (fastify, opts, callback): void => {
  callback();
};

//new
export function registerValidatorRoutes(server: FastifyInstance): void {
  server.register(
    async function (fastify) {
      fastify.post(attesterDutiesController.url, attesterDutiesController.opts, attesterDutiesController.handler);
      fastify.get(produceBlockController.url, produceBlockController.opts, produceBlockController.handler);
      fastify.get(proposerDutiesController.url, proposerDutiesController.opts, proposerDutiesController.handler);
      fastify.get(produceAttestationData.url, produceAttestationData.opts, produceAttestationData.handler);
      fastify.post(prepareCommitteeSubnet.url, prepareCommitteeSubnet.opts, prepareCommitteeSubnet.handler);
      fastify.get(
        produceAggregatedAttestation.url,
        produceAggregatedAttestation.opts,
        produceAggregatedAttestation.handler
      );
      fastify.post(publishAggregateAndProof.url, publishAggregateAndProof.opts, publishAggregateAndProof.handler);
    },
    {prefix: "/v1/validator"}
  );
}
