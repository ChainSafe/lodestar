import {
  AggregateAndProof,
  Attestation,
  AttestationData,
  AttesterDuty,
  BeaconBlock,
  BLSPubkey,
  BLSSignature,
  CommitteeIndex,
  Epoch,
  ProposerDuty,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  Slot,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";

export interface IValidatorApi {
  getProposerDuties(epoch: Epoch, validatorPubKeys: BLSPubkey[]): Promise<ProposerDuty[]>;

  getAttesterDuties(epoch: Epoch, validatorPubKeys: ValidatorIndex[]): Promise<AttesterDuty[]>;

  /**
   * Requests a BeaconNode to produce a valid block,
   * which can then be signed by a ValidatorClient.
   * @returns {Promise<BeaconBlock>} A proposed BeaconBlock object
   */
  produceBlock(slot: Slot, randaoReveal: Uint8Array, graffiti: string): Promise<BeaconBlock>;

  /**
   * Requests that the BeaconNode produce an Attestation,
   * with a blank signature field, which the ValidatorClient will then sign.
   */
  produceAttestation(validatorPubKey: BLSPubkey, index: CommitteeIndex, slot: Slot): Promise<Attestation>;

  /**
   * Instructs the BeaconNode to publish a newly signed Attestation object,
   * to be incorporated into the beacon chain.
   */
  publishAttestation(attestation: Attestation): Promise<void>;

  publishAggregateAndProof(signedAggregateAndProof: SignedAggregateAndProof): Promise<void>;

  getWireAttestations(epoch: Epoch, committeeIndex: CommitteeIndex): Promise<Attestation[]>;

  produceAggregateAndProof(attestationData: AttestationData, aggregator: BLSPubkey): Promise<AggregateAndProof>;

  subscribeCommitteeSubnet(
    slot: Slot,
    slotSignature: BLSSignature,
    committeeIndex: CommitteeIndex,
    aggregatorPubkey: BLSPubkey
  ): Promise<void>;
}
