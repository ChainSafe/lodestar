import {Epoch, Root} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";

export function isEqualRoot(root1: Root, root2: Root): boolean {
  return toHexString(root1) === toHexString(root2);
}

export function isZeroRoot(root: Root): boolean {
  return isEqualRoot(root, ZERO_HASH);
}

export function minEpoch(epochs: Epoch[]): Epoch | null {
  return epochs.length > 0 ? Math.min(...epochs) : null;
}
