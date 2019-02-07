import {Validator} from "../../types";

/**
 * Generates a single fake validator, for tests purposes only.
 * @param {number} activation
 * @param {number} exit
 * @returns {Validator}
 */
export function generateValidator(activation?: number, exit?: number): Validator {
  const randNum = () =>  Math.floor(Math.random() * Math.floor(4));
  // For some reason activationEpoch was defaulting to randNum()
  const activationValue = activation !== null ? activation : randNum();
  return {
    pubkey: new Uint8Array(48),
    withdrawalCredentials: Uint8Array.of(65),
    activationEpoch: activationValue,
    exitEpoch: exit || randNum(),
    withdrawalEpoch: randNum(),
    penalizedEpoch: randNum(),
    statusFlags: randNum(),
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
