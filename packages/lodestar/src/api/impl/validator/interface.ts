/**
 * @module api/rpc
 */
import {BLSSignature, CommitteeIndex, Epoch, Root, phase0, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";

export type BeaconCommitteeSubscription = {
  validatorIndex: number;
  committeeIndex: number;
  committeesAtSlot: number;
  slot: number;
  isAggregator: boolean;
};

/**
 * The API interface defines the calls that can be made from a Validator
 */
export interface IValidatorApi {
  getProposerDuties(epoch: Epoch): Promise<phase0.ProposerDuty[]>;

  getAttesterDuties(epoch: Epoch, validatorIndices: ValidatorIndex[]): Promise<phase0.AttesterDuty[]>;

  /**
   * Requests a BeaconNode to produce a valid block,
   * which can then be signed by a ValidatorClient.
   * @returns {Promise<BeaconBlock>} A proposed BeaconBlock object
   */
  produceBlock(slot: Slot, randaoReveal: BLSSignature, graffiti: string): Promise<phase0.BeaconBlock>;

  produceAttestationData(index: CommitteeIndex, slot: Slot): Promise<phase0.AttestationData>;

  getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<phase0.Attestation>;

  publishAggregateAndProofs(signedAggregateAndProofs: phase0.SignedAggregateAndProof[]): Promise<void>;

  prepareBeaconCommitteeSubnet(subscriptions: BeaconCommitteeSubscription[]): Promise<void>;
}
