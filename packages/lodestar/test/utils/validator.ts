import {Validator} from "@chainsafe/lodestar-types";
import {FAR_FUTURE_EPOCH} from "../../src/constants";

export interface ValidatorGeneratorOpts {
  activation?: number;
  exit?: number;
  slashed?: boolean;
  balance?: bigint;
}

/**
 * Generates a single fake validator, for tests purposes only.
 * @returns {Validator}
 * @param opts
 */
export function generateValidator(opts: Partial<Validator> = {}): Validator {
  const randNum = (): number =>  Math.floor(Math.random() * Math.floor(4));
  const activationEpoch =
      (opts.activationEpoch || opts.activationEpoch === 0) ? opts.activationEpoch : FAR_FUTURE_EPOCH;
  return {
    pubkey: opts.pubkey || Buffer.alloc(48),
    withdrawalCredentials: Buffer.alloc(32),
    activationEpoch,
    activationEligibilityEpoch: activationEpoch,
    exitEpoch: opts.exitEpoch || randNum(),
    withdrawableEpoch: randNum(),
    slashed: opts.slashed || false,
    effectiveBalance: opts.effectiveBalance || 0n
  };
}

/**
 * Generates n number of validators, for tests purposes only.
 * @param {number} n
 * @returns {Validator[]}
 */
export function generateValidators(n: number, opts?: ValidatorGeneratorOpts): Validator[] {
  return Array.from({length: n}, () => generateValidator(opts));
}
