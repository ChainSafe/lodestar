import {
  Attestation,
  AttestationData,
  AttesterDuty,
  BeaconBlock,
  BLSPubkey,
  CommitteeIndex,
  Epoch,
  ProposerDuty,
  Root,
  SignedAggregateAndProof,
  Slot,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";

export type BeaconCommitteeSubscription = {
  validatorIndex: number;
  committeeIndex: number;
  committeesAtSlot: number;
  slot: number;
  isAggregator: boolean;
};

export interface IValidatorApi {
  getProposerDuties(epoch: Epoch, validatorPubKeys: BLSPubkey[]): Promise<ProposerDuty[]>;

  getAttesterDuties(epoch: Epoch, indices: ValidatorIndex[]): Promise<AttesterDuty[]>;

  /**
   * Requests a BeaconNode to produce a valid block,
   * which can then be signed by a ValidatorClient.
   * @returns {Promise<BeaconBlock>} A proposed BeaconBlock object
   */
  produceBlock(slot: Slot, randaoReveal: Uint8Array, graffiti: string): Promise<BeaconBlock>;

  produceAttestationData(index: CommitteeIndex, slot: Slot): Promise<AttestationData>;

  getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<Attestation>;

  publishAggregateAndProofs(signedAggregateAndProofs: SignedAggregateAndProof[]): Promise<void>;

  prepareBeaconCommitteeSubnet(subscriptions: BeaconCommitteeSubscription[]): Promise<void>;
}
