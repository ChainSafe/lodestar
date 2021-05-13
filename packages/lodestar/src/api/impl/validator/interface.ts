/**
 * @module api/rpc
 */
import {
  BLSSignature,
  CommitteeIndex,
  Epoch,
  Root,
  phase0,
  Slot,
  ValidatorIndex,
  altair,
} from "@chainsafe/lodestar-types";

/**
 * The API interface defines the calls that can be made from a Validator
 */
export interface IValidatorApi {
  getProposerDuties(epoch: Epoch): Promise<phase0.ProposerDutiesApi>;
  getAttesterDuties(epoch: Epoch, validatorIndices: ValidatorIndex[]): Promise<phase0.AttesterDutiesApi>;
  getSyncCommitteeDuties(epoch: number, validatorIndices: ValidatorIndex[]): Promise<altair.SyncDutiesApi>;
  produceBlock(slot: Slot, randaoReveal: BLSSignature, graffiti: string): Promise<phase0.BeaconBlock>;
  produceAttestationData(index: CommitteeIndex, slot: Slot): Promise<phase0.AttestationData>;
  produceSyncCommitteeContribution(
    slot: Slot,
    subcommitteeIndex: number,
    beaconBlockRoot: Root
  ): Promise<altair.SyncCommitteeContribution>;
  getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<phase0.Attestation>;
  publishAggregateAndProofs(signedAggregateAndProofs: phase0.SignedAggregateAndProof[]): Promise<void>;
  publishContributionAndProofs(contributionAndProofs: altair.SignedContributionAndProof[]): Promise<void>;
  prepareBeaconCommitteeSubnet(subscriptions: phase0.BeaconCommitteeSubscription[]): Promise<void>;
  prepareSyncCommitteeSubnets(subscriptions: altair.SyncCommitteeSubscription[]): Promise<void>;
}
