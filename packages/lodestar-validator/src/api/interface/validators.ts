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
import {BeaconBlockType} from "@chainsafe/lodestar-utils";

export interface IValidatorApi {
  getProposerDuties(epoch: Epoch, validatorPubKeys: BLSPubkey[]): Promise<ProposerDuty[]>;

  getAttesterDuties(epoch: Epoch, validatorPubKeys: ValidatorIndex[]): Promise<AttesterDuty[]>;

  /**
   * Requests a BeaconNode to produce a valid block,
   * which can then be signed by a ValidatorClient.
   * @returns {Promise<BeaconBlock>} A proposed BeaconBlock object
   */
  produceBlock(slot: Slot, randaoReveal: Uint8Array, graffiti: string): Promise<BeaconBlockType>;

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
