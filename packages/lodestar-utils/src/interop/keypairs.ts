import {hash} from "@chainsafe/ssz";
import bls from "@chainsafe/bls";
import {toBufferBE} from "bigint-buffer";
import {bytesToBigInt, intToBytes} from "../bytes";

const CURVE_ORDER = BigInt("52435875175126190479447740508185965837690552500527637822603658699938581184513");

interface IInteropKeypair {
  pubkey: Buffer;
  privkey: Buffer;
}

export function interopKeypairs(validatorCount: number): IInteropKeypair[] {
  return Array.from({length: validatorCount}, (_, i) => {
    return interopKeypair(i);
  });
}

export function interopKeypair(index: number): IInteropKeypair {
  const privkey = toBufferBE(bytesToBigInt(hash(intToBytes(index, 32))) % CURVE_ORDER, 32);
  const pubkey = Buffer.from(bls.SecretKey.fromBytes(privkey).toPublicKey().toBytes());
  return {
    privkey,
    pubkey,
  };
}
