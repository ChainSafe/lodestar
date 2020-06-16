import {Validator, Slot} from "@chainsafe/lodestar-types";
import {FAR_FUTURE_EPOCH} from "../../src/constants";

export interface ValidatorGeneratorOpts {
  activation?: Slot;
  exit?: Slot;
  slashed?: boolean;
  balance?: bigint;
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
  const activationEpoch = (opts.activation || opts.activation === 0n) ? opts.activation : FAR_FUTURE_EPOCH;
  return {
    pubkey: Buffer.alloc(48),
    withdrawalCredentials: Buffer.alloc(32),
    activationEpoch,
    activationEligibilityEpoch: activationEpoch,
    exitEpoch: opts.exit || BigInt(randNum()),
    withdrawableEpoch: BigInt(randNum()),
    slashed: opts.slashed || false,
    effectiveBalance: opts.balance || 0n
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
