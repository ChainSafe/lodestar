import {
  AggregateAndProof,
  Attestation,
  AttestationData,
  AttesterDuty,
  BeaconBlock,
  BLSPubkey,
  BLSSignature,
  CommitteeIndex,
  Epoch, ProposerDuty,
  SignedBeaconBlock,
  Slot
} from "@chainsafe/lodestar-types";

export interface IValidatorApi {
  
  getProposerDuties(epoch: Epoch, validatorPubKeys: BLSPubkey[]): Promise<ProposerDuty[]>;

  getAttesterDuties(epoch: Epoch, validatorPubKeys: BLSPubkey[]): Promise<AttesterDuty[]>;

  /**
   * Requests a BeaconNode to produce a valid block,
   * which can then be signed by a ValidatorClient.
   * @returns {Promise<BeaconBlock>} A proposed BeaconBlock object
   */
  produceBlock(slot: Slot, proposerPubkey: BLSPubkey, randaoReveal: Uint8Array): Promise<BeaconBlock>;

  /**
   * Requests that the BeaconNode produce an Attestation,
   * with a blank signature field, which the ValidatorClient will then sign.
   */
  produceAttestation(validatorPubKey: BLSPubkey, index: CommitteeIndex, slot: Slot):
  Promise<Attestation>;

  /**
   * Instructs the BeaconNode to publish a newly signed beacon block
   * to the beacon network, to be included in the beacon chain.
   */
  publishBlock(signedBlock: SignedBeaconBlock): Promise<void>;

  /**
   * Instructs the BeaconNode to publish a newly signed Attestation object,
   * to be incorporated into the beacon chain.
   */
  publishAttestation(attestation: Attestation): Promise<void>;

  publishAggregateAndProof(
    aggregated: AggregateAndProof
  ): Promise<void>;

  getWireAttestations(epoch: Epoch, committeeIndex: CommitteeIndex): Promise<Attestation[]>;

  produceAggregateAndProof(attestationData: AttestationData, aggregator: BLSPubkey): Promise<AggregateAndProof>;

  subscribeCommitteeSubnet(
    slot: Slot, slotSignature: BLSSignature, committeeIndex: CommitteeIndex, aggregatorPubkey: BLSPubkey
  ): Promise<void>;
}
