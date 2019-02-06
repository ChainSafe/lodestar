import {Validator} from "../../types";

export function generateValidator(activation: number = null, exit: number = null): Validator {
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

export function generateValidators(n: number): Validator[] {
  return Array.from({ length: n }, () => generateValidator());
}
