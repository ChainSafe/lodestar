import BN from "bn.js";
import {Validator} from "../../src/types";
import { FAR_FUTURE_EPOCH } from "../../src/constants";

/**
 * Generates a single fake validator, for tests purposes only.
 * @param {number} activation
 * @param {number} exit
 * @param {boolean} slashed
 * @returns {Validator}
 */
export function generateValidator(activation?: number, exit?: number, slashed: boolean = false): Validator {
  const randNum = () =>  Math.floor(Math.random() * Math.floor(4));
  const activationEpoch = (activation || activation === 0) ? activation : FAR_FUTURE_EPOCH;
  return {
    pubkey: Buffer.alloc(48),
    withdrawalCredentials: Buffer.alloc(32),
    activationEpoch,
    activationEligibilityEpoch: activationEpoch,
    exitEpoch: exit || randNum(),
    withdrawableEpoch: randNum(),
    slashed,
    effectiveBalance: new BN(0),
  };
}

/**
 * Generates n number of validators, for tests purposes only.
 * @param {number} n
 * @returns {Validator[]}
 */
export function generateValidators(n: number): Validator[] {
  return Array.from({ length: n }, () => generateValidator());
}


export function validatorFromYaml(value: any): Validator {
  return {
    pubkey: Buffer.from(value.pubkey.slice(2), 'hex'),
    withdrawalCredentials: Buffer.from(value.withdrawalCredentials.slice(2), 'hex'),
    activationEpoch: (value.activationEpoch as BN).bitLength() >= 52 ? FAR_FUTURE_EPOCH : value.activationEpoch.toNumber(),
    activationEligibilityEpoch: (value.activationEligibilityEpoch as BN).bitLength() >= 52 ? FAR_FUTURE_EPOCH : value.activationEligibilityEpoch.toNumber(),
    exitEpoch: (value.exitEpoch as BN).bitLength() >= 52 ? FAR_FUTURE_EPOCH : value.exitEpoch.toNumber(),
    withdrawableEpoch: ((value.withdrawableEpoch as BN).bitLength() > 52) ? FAR_FUTURE_EPOCH : value.withdrawableEpoch.toNumber(),
    slashed: value.slashed,
    effectiveBalance: value.effectiveBalance,
  };
}
