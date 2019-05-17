/**
 * @module db/api/validator
 */

import {Attestation, BeaconBlock, ValidatorIndex} from "../../../types";

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
   * Obtains last attestation proposed by validator with given index
   */
  getAttestation(index: ValidatorIndex): Promise<Attestation>;

  /**
   * Stores attestation proposed by validator with given index
   */
  setAttestation(index: ValidatorIndex, attestation: Attestation): Promise<void>;

}
