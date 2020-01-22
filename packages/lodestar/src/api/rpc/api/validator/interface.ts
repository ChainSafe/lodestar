/**
 * @module api/rpc
 */
import {
  Attestation,
  BeaconBlock,
  BLSPubkey,
  BLSSignature,
  bytes,
  CommitteeIndex,
  Epoch,
  Slot,
  ValidatorDuty,
  SignedBeaconBlock
} from "@chainsafe/eth2.0-types";
import {IApi} from "../../../interface";

/**
 * The API interface defines the calls that can be made from a Validator
 */
export interface IValidatorApi extends IApi {

  getProposerDuties(epoch: Epoch): Promise<Map<Slot, BLSPubkey>>;

  getAttesterDuties(epoch: Epoch, validatorPubKey: BLSPubkey[]): Promise<ValidatorDuty[]>;

  isAggregator(slot: Slot, committeeIndex: CommitteeIndex, slotSignature: BLSSignature): Promise<boolean>;

  /**
   * Requests a BeaconNode to produce a valid block,
   * which can then be signed by a ValidatorClient.
   * @returns {Promise<BeaconBlock>} A proposed BeaconBlock object
   */
  produceBlock(slot: Slot, randaoReveal: bytes): Promise<BeaconBlock>;

  /**
   * Requests that the BeaconNode produce an IndexedAttestation,
   * with a blank signature field, which the ValidatorClient will then sign.
   */
  produceAttestation(validatorPubKey: BLSPubkey, pocBit: boolean, index: CommitteeIndex, slot: Slot):
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

  publishAggregatedAttestation(
    aggregated: Attestation, validatorPubKey: BLSPubkey, slotSignature: BLSSignature
  ): Promise<void>;

  getWireAttestations(epoch: Epoch, committeeIndex: CommitteeIndex): Promise<Attestation[]>;
}
