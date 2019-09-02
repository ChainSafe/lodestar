import BN from "bn.js";
import {BLSPubkey, BLSSecretKey} from "@chainsafe/eth2.0-types";
import {generatePublicKey} from "@chainsafe/bls";
import {hash} from "@chainsafe/ssz";

import {bytesToBN, intToBytes} from "../util/bytes";

const CURVE_ORDER = new BN('52435875175126190479447740508185965837690552500527637822603658699938581184513');

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
  const privkey = bytesToBN(hash(intToBytes(index, 32)))
    .mod(CURVE_ORDER)
    .toArrayLike(Buffer, 'be', 32);
  const pubkey = generatePublicKey(privkey);
  return {
    privkey,
    pubkey,
  };
}
