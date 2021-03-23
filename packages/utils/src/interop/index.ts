import {hash} from "@chainsafe/ssz";
import bls, {SecretKey} from "@chainsafe/bls";
import {toBufferBE} from "bigint-buffer";
import {bytesToBigInt, intToBytes} from "../bytes";

const CURVE_ORDER = BigInt("52435875175126190479447740508185965837690552500527637822603658699938581184513");

export function interopSecretKeys(validatorCount: number): SecretKey[] {
  return Array.from({length: validatorCount}, (ignored, i) => {
    return interopSecretKey(i);
  });
}

export function interopSecretKey(index: number): SecretKey {
  const secretKeyBytes = toBufferBE(bytesToBigInt(hash(intToBytes(index, 32))) % CURVE_ORDER, 32);
  return bls.SecretKey.fromBytes(secretKeyBytes);
}
