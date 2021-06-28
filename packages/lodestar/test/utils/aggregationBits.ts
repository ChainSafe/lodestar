import {List} from "@chainsafe/ssz";

/** Create a filled bits array with a single true bit */
export function toSingleBit(len: number, index: number): List<boolean> {
  const bits = ([] as boolean[]) as List<boolean>;
  for (let i = 0; i < len; i++) bits[i] = false;
  bits[index] = true;
  return bits;
}
