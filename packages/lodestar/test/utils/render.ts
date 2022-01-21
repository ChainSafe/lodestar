import {BitArray} from "@chainsafe/ssz";

export function renderBitArray(bitArray: BitArray): string {
  return Buffer.from(bitArray.uint8Array).toString("hex");
}
