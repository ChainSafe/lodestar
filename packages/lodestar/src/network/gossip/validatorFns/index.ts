import {GossipType} from "../interface";
import {validateAggregatedAttestation} from "./aggregatedAttestation";
import {validateCommitteeAttestation} from "./attestation";
import {validateAttesterSlashing} from "./attesterSlashing";
import {validateBeaconBlock} from "./block";
import {validateProposerSlashing} from "./proposerSlashing";
import {validateVoluntaryExit} from "./voluntaryExit";

export const validatorFns = {
  [GossipType.beacon_block]: validateBeaconBlock,
  [GossipType.beacon_aggregate_and_proof]: validateCommitteeAttestation,
  [GossipType.beacon_attestation]: validateAggregatedAttestation,
  [GossipType.voluntary_exit]: validateVoluntaryExit,
  [GossipType.proposer_slashing]: validateProposerSlashing,
  [GossipType.attester_slashing]: validateAttesterSlashing,
};
