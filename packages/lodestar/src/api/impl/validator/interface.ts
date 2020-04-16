/**
 * @module api/rpc
 */
import {
  AggregateAndProof,
  Attestation, AttestationData,
  AttesterDuty,
  BeaconBlock,
  BLSPubkey,
  BLSSignature,
  CommitteeIndex,
  Epoch, ProposerDuty,
  SignedBeaconBlock,
  Slot
} from "@chainsafe/lodestar-types";
import {IApi} from "../../interface";

/**
 * The API interface defines the calls that can be made from a Validator
 */
export interface IValidatorApi extends IApi {

  getProposerDuties(epoch: Epoch): Promise<ProposerDuty[]>;

  getAttesterDuties(epoch: Epoch, validatorPubKey: BLSPubkey[]): Promise<AttesterDuty[]>;

  /**
   * Requests a BeaconNode to produce a valid block,
   * which can then be signed by a ValidatorClient.
   * @returns {Promise<BeaconBlock>} A proposed BeaconBlock object
   */
  produceBlock(slot: Slot, randaoReveal: BLSSignature): Promise<BeaconBlock>;

  /**
   * Requests that the BeaconNode produce an IndexedAttestation,
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
   * Instructs the BeaconNode to publish a newly signed IndexedAttestation object,
   * to be incorporated into the beacon chain.
   */
  publishAttestation(attestation: Attestation): Promise<void>;

  publishAggregateAndProof(
    aggregate: AggregateAndProof
  ): Promise<void>;

  produceAggregateAndProof(attestationData: AttestationData, aggregator: BLSPubkey): Promise<AggregateAndProof>;

  getWireAttestations(epoch: Epoch, committeeIndex: CommitteeIndex): Promise<Attestation[]>;

  subscribeCommitteeSubnet(
    slot: Slot, slotSignature: BLSSignature, committeeIndex: CommitteeIndex, aggregatorPubkey: BLSPubkey
  ): Promise<void>;
  
}
