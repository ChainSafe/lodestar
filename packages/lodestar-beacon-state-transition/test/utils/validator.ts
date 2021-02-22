import {List} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {FAR_FUTURE_EPOCH} from "../../src/constants";

export interface IValidatorGeneratorOpts {
  activation?: number;
  exit?: number;
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
export function generateValidator(opts: IValidatorGeneratorOpts = {}): phase0.Validator {
  const randNum = (): number => Math.floor(Math.random() * Math.floor(4));
  const activationEpoch = opts.activation || opts.activation === 0 ? opts.activation : FAR_FUTURE_EPOCH;
  return {
    pubkey: Buffer.alloc(48),
    withdrawalCredentials: Buffer.alloc(32),
    activationEpoch,
    activationEligibilityEpoch: activationEpoch,
    exitEpoch: opts.exit || randNum(),
    withdrawableEpoch: randNum(),
    slashed: opts.slashed || false,
    effectiveBalance: opts.balance || BigInt(0),
  };
}

/**
 * Generates n number of validators, for tests purposes only.
 * @param {number} n
 * @returns {Validator[]}
 */
export function generateValidators(n: number, opts?: IValidatorGeneratorOpts): List<phase0.Validator> {
  return Array.from({length: n}, () => generateValidator(opts)) as List<phase0.Validator>;
}
