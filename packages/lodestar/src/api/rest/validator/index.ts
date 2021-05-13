import {getAttesterDuties} from "./duties/getAttesterDuties";
import {getProposerDuties} from "./duties/getProposerDuties";
import {getSyncCommitteeDuties} from "./duties/getSyncCommitteeDuties";
import {getAggregatedAttestation} from "./getAggregatedAttestation";
import {prepareBeaconCommitteeSubnet} from "./prepareBeaconCommitteeSubnet";
import {prepareSyncCommitteeSubnets} from "./prepareSyncCommitteeSubnets";
import {produceAttestationData} from "./produceAttestationData";
import {produceBlock, produceBlockV2} from "./produceBlock";
import {produceSyncCommitteeContribution} from "./produceSyncCommitteeContribution";
import {publishAggregateAndProof} from "./publishAggregateAndProof";
import {publishContributionAndProofs} from "./publishContributionAndProofs";

export const validatorRoutes = [
  getAttesterDuties,
  getProposerDuties,
  getSyncCommitteeDuties,
  getAggregatedAttestation,
  prepareBeaconCommitteeSubnet,
  prepareSyncCommitteeSubnets,
  produceAttestationData,
  produceBlock,
  produceBlockV2,
  produceSyncCommitteeContribution,
  publishAggregateAndProof,
  publishContributionAndProofs,
];
