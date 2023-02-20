import {fromHexString} from "@chainsafe/ssz";
import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {phase0} from "@lodestar/types";

export type ValidatorGeneratorOpts = {
  activation?: number;
  exit?: number;
  withdrawableEpoch?: number;
  slashed?: boolean;
  balance?: number;
};

/**
 * Generates a single fake validator, for tests purposes only.
 * @param {number} activation
 * @param {number} exit
 * @param {boolean} slashed
 * @returns {Validator}
 */
export function generateValidator(opts: ValidatorGeneratorOpts = {}): phase0.Validator {
  const randNum = (): number => Math.floor(Math.random() * Math.floor(4));
  const activationEpoch = opts.activation !== undefined || opts.activation === 0 ? opts.activation : FAR_FUTURE_EPOCH;
  return {
    pubkey: fromHexString(
      // randomly pregenerated pubkey
      "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576"
    ),
    withdrawalCredentials: Buffer.alloc(32),
    activationEpoch,
    activationEligibilityEpoch: activationEpoch,
    exitEpoch: opts.exit ?? randNum(),
    withdrawableEpoch: opts.withdrawableEpoch ?? randNum(),
    slashed: opts.slashed || false,
    effectiveBalance: opts.balance ?? 0,
  };
}

/**
 * Generates n number of validators, for tests purposes only.
 * @param {number} n
 * @returns {Validator[]}
 */
export function generateValidators(n: number, opts?: ValidatorGeneratorOpts): phase0.Validator[] {
  return Array.from({length: n}, () => generateValidator(opts));
}
