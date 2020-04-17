import {BLSSignature, Number64} from "@chainsafe/lodestar-types";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";

export function isValidatorAggregator(slotSignature: BLSSignature, modulo: Number64): boolean {
  return (bytesToInt(hash(slotSignature.valueOf() as Uint8Array).slice(0, 8)) % modulo) === 0;
}