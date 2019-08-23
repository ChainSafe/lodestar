import BN from "bn.js";
import {Validator} from "@chainsafe/eth2.0-types";
import {FAR_FUTURE_EPOCH} from "../../src/constants";

export interface ValidatorGeneratorOpts {
  activation?: number;
  exit?: number;
  slashed?: boolean;
  balance?: BN;
}

/**
 * Generates a single fake validator, for tests purposes only.
 * @param {number} activation
 * @param {number} exit
 * @param {boolean} slashed
 * @returns {Validator}
 */
export function generateValidator(opts: ValidatorGeneratorOpts = {}): Validator {
  const randNum = () =>  Math.floor(Math.random() * Math.floor(4));
  const activationEpoch = (opts.activation || opts.activation === 0) ? opts.activation : FAR_FUTURE_EPOCH;
  return {
    pubkey: Buffer.alloc(48),
    withdrawalCredentials: Buffer.alloc(32),
    activationEpoch,
    activationEligibilityEpoch: activationEpoch,
    exitEpoch: opts.exit || randNum(),
    withdrawableEpoch: randNum(),
    slashed: opts.slashed || false,
    effectiveBalance: opts.balance || new BN(0)
  };
}

/**
 * Generates n number of validators, for tests purposes only.
 * @param {number} n
 * @returns {Validator[]}
 */
export function generateValidators(n: number, opts?: ValidatorGeneratorOpts): Validator[] {
  return Array.from({ length: n }, () => generateValidator(opts));
}
