import {attesterDutiesController, proposerDutiesController} from "./duties";
import {produceAttestationData} from "./produceAttestationData";
import {prepareCommitteeSubnet} from "./prepareCommitteeSubnet";
import {produceAggregatedAttestation} from "./produceAggregatedAttestation";
import {publishAggregateAndProof} from "./publishAggregateAndProof";
import {produceBlockController} from "./produceBlock";

export const validatorRoutes = [
  attesterDutiesController,
  proposerDutiesController,
  produceAttestationData,
  prepareCommitteeSubnet,
  produceAggregatedAttestation,
  publishAggregateAndProof,
  produceBlockController,
];
