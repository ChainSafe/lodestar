/**
 * @module db/api/validator
 */

import {Attestation, BeaconBlock, BLSPubkey, Epoch} from "@chainsafe/eth2.0-types";

export interface AttestationSearchOptions {
  gt?: Epoch;
  lt?: Epoch;
}

export interface IValidatorDB {

  /**
   * Obtains last proposed beacon block
   * by validator with given index
   */
  getBlock(pubKey: BLSPubkey): Promise<BeaconBlock>;

  /**
   * Stores beacon block proposed by validator with given index
   */
  setBlock(pubKey: BLSPubkey, block: BeaconBlock): Promise<void>;

  /**
   * Searches proposed attestations based on target epoch and validator index
   * @param pubKey validator signing pubkey
   * @param options object contains lower and higher target epoch to search
   */
  getAttestations(pubKey: BLSPubkey, options?: AttestationSearchOptions): Promise<Attestation[]>;

  /**
   * Stores attestation proposed by validator with given index
   */
  setAttestation(pubKey: BLSPubkey, attestation: Attestation): Promise<void>;


  deleteAttestations(pubKey: BLSPubkey, attestation: Attestation[]): Promise<void>;
}
