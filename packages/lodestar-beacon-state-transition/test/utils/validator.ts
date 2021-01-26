import {List} from "@chainsafe/ssz";
import {Validator} from "@chainsafe/lodestar-types";
import {FAR_FUTURE_EPOCH} from "../../src/constants";
import {interopSecretKey} from "@chainsafe/lodestar-utils";

export interface IValidatorGeneratorOpts {
  index?: number;
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
export function generateValidator(opts: IValidatorGeneratorOpts = {}): Validator {
  const randNum = (): number => Math.floor(Math.random() * Math.floor(4));
  const activationEpoch = opts.activation || opts.activation === 0 ? opts.activation : FAR_FUTURE_EPOCH;
  return {
    pubkey:
      opts.index === undefined
        ? Buffer.alloc(48)
        : interopSecretKey(opts.index ?? 0)
            .toPublicKey()
            .toBytes(),
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
export function generateValidators(n: number, opts?: IValidatorGeneratorOpts): List<Validator> {
  return Array.from({length: n}, (_, index) => generateValidator({...opts, index: index})) as List<Validator>;
}
