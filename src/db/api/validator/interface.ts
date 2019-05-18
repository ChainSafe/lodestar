/**
 * @module db/api/validator
 */

import {Attestation, BeaconBlock, Epoch, ValidatorIndex} from "../../../types";

export interface AttestationSearchOptions {
  gt?: Epoch;
  lt?: Epoch;
}

export interface IValidatorDB {

  /**
   * Obtains last proposed beacon block
   * by validator with given index
   */
  getBlock(index: ValidatorIndex): Promise<BeaconBlock>;

  /**
   * Stores beacon block proposed by validator with given index
   */
  setBlock(index: ValidatorIndex, block: BeaconBlock): Promise<void>;

  /**
   * Searches proposed attestations based on target epoch and validator index
   * @param index index of validator in registry
   * @param options object contains lower and higher target epoch to search
   */
  getAttestation(index: ValidatorIndex, options?: AttestationSearchOptions): Promise<Attestation[]>;

  /**
   * Stores attestation proposed by validator with given index
   */
  setAttestation(index: ValidatorIndex, attestation: Attestation): Promise<void>;

}
