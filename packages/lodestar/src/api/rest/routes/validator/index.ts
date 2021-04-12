import {FastifyInstance} from "fastify";
import {registerRoutesToServer} from "../util";
import {
  attesterDutiesController,
  produceAggregatedAttestation,
  produceAttestationData,
  produceBlockController,
  proposerDutiesController,
  publishAggregateAndProof,
} from "../../controllers/validator";
import {prepareCommitteeSubnet} from "../../controllers/validator/prepareCommitteeSubnet";

//new
export function registerValidatorRoutes(server: FastifyInstance): void {
  const routes = [
    produceBlockController,
    proposerDutiesController,
    produceAttestationData,
    produceAggregatedAttestation,
    attesterDutiesController,
    prepareCommitteeSubnet,
    publishAggregateAndProof,
  ];

  registerRoutesToServer(server, routes, "/v1/validator");
}
