import {fromHexString, List} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {FAR_FUTURE_EPOCH} from "../../src/constants";

/**
 * Generates a single fake validator, for tests purposes only.
 * @returns {Validator}
 * @param opts
 */
export function generateValidator(opts: Partial<phase0.Validator> = {}): phase0.Validator {
  const randNum = (): number => Math.floor(Math.random() * Math.floor(4));
  const activationEpoch = opts.activationEpoch ?? FAR_FUTURE_EPOCH;
  return {
    pubkey:
      opts.pubkey ||
      fromHexString(
        // randomly pregenerated pubkey
        "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576"
      ),
    withdrawalCredentials: Buffer.alloc(32),
    activationEpoch,
    activationEligibilityEpoch: activationEpoch,
    exitEpoch: opts.exitEpoch ?? randNum(),
    withdrawableEpoch: opts.withdrawableEpoch ?? randNum(),
    slashed: opts.slashed || false,
    effectiveBalance: opts.effectiveBalance ?? 0,
  };
}

/**
 * Generates n number of validators, for tests purposes only.
 * @param {number} n
 * @param opts
 * @returns {Validator[]}
 */
export function generateValidators(n: number, opts?: Partial<phase0.Validator>): List<phase0.Validator> {
  return Array.from({length: n}, () => generateValidator(opts)) as List<phase0.Validator>;
}
