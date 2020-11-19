/**
 * @module api/rpc
 */
import {
  Attestation,
  AttestationData,
  AttesterDuty,
  BeaconBlock,
  BLSPubkey,
  BLSSignature,
  CommitteeIndex,
  Epoch,
  ProposerDuty,
  Root,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  Slot,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";

/**
 * The API interface defines the calls that can be made from a Validator
 */
export interface IValidatorApi {
  getProposerDuties(epoch: Epoch): Promise<ProposerDuty[]>;

  getAttesterDuties(epoch: Epoch, validatorIndices: ValidatorIndex[]): Promise<AttesterDuty[]>;

  /**
   * Requests a BeaconNode to produce a valid block,
   * which can then be signed by a ValidatorClient.
   * @returns {Promise<BeaconBlock>} A proposed BeaconBlock object
   */
  produceBlock(slot: Slot, randaoReveal: BLSSignature, graffiti: string): Promise<BeaconBlock>;

  produceAttestationData(index: CommitteeIndex, slot: Slot): Promise<AttestationData>;

  getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<Attestation>;

  publishAggregateAndProofs(signedAggregateAndProofs: SignedAggregateAndProof[]): Promise<void>;

  prepareBeaconCommitteeSubnet(
    validatorIndex: ValidatorIndex,
    committeeIndex: CommitteeIndex,
    committeesAtSlot: number,
    slot: Slot,
    isAggregator: boolean
  ): Promise<void>;
}
