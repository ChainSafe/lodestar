import {BLSPubkey, BLSSecretKey} from "@chainsafe/eth2.0-types";
import {generatePublicKey} from "@chainsafe/bls";
import {hash} from "@chainsafe/ssz";
import {bytesToBigInt, intToBytes} from "@chainsafe/eth2.0-utils";
import {toBufferBE} from "bigint-buffer";

const CURVE_ORDER = BigInt("52435875175126190479447740508185965837690552500527637822603658699938581184513");

interface IKeypair {
  pubkey: BLSPubkey;
  privkey: BLSSecretKey;
}

export function interopKeypairs(validatorCount: number): IKeypair[] {
  return Array.from({length: validatorCount}, (_, i) => {
    return interopKeypair(i);
  });
}

export function interopKeypair(index: number): IKeypair {
  const privkey =
    toBufferBE(bytesToBigInt(hash(intToBytes(index, 32))) % CURVE_ORDER, 32);
  const pubkey = generatePublicKey(privkey);
  return {
    privkey,
    pubkey,
  };
}
