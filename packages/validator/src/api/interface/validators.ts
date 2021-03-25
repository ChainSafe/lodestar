import {BLSPubkey, CommitteeIndex, Epoch, Root, phase0, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";

export interface IValidatorApi {
  getProposerDuties(epoch: Epoch, validatorPubKeys: BLSPubkey[]): Promise<phase0.ProposerDuty[]>;

  getAttesterDuties(epoch: Epoch, indices: ValidatorIndex[]): Promise<phase0.AttesterDuty[]>;

  /**
   * Requests a BeaconNode to produce a valid block,
   * which can then be signed by a ValidatorClient.
   * @returns {Promise<BeaconBlock>} A proposed BeaconBlock object
   */
  produceBlock(slot: Slot, randaoReveal: Uint8Array, graffiti: string): Promise<phase0.BeaconBlock>;

  produceAttestationData(index: CommitteeIndex, slot: Slot): Promise<phase0.AttestationData>;

  getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<phase0.Attestation>;

  publishAggregateAndProofs(signedAggregateAndProofs: phase0.SignedAggregateAndProof[]): Promise<void>;

  prepareBeaconCommitteeSubnet(subscriptions: phase0.BeaconCommitteeSubscription[]): Promise<void>;
}
