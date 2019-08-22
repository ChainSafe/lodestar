import BN from "bn.js";
import {Validator} from "@chainsafe/eth2.0-types";
import {FAR_FUTURE_EPOCH} from "../../src/constants";

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
    effectiveBalance: new BN(2 ** 5 * 1e9)
  };
}

/**
 * Generates n number of validators, for tests purposes only.
 * @param {number} n
 * @returns {Validator[]}
 */
export function generateValidators(n: number, ...opts): Validator[] {
  return Array.from({ length: n }, () => generateValidator(...opts));
}
