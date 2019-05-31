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
  // For some reason activationEpoch was defaulting to randNum()
  const activationEpoch = activation ? activation : FAR_FUTURE_EPOCH;
  return {
    pubkey: Buffer.alloc(48),
    withdrawalCredentials: Buffer.alloc(65),
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
