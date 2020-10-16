import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, Root} from "@chainsafe/lodestar-types";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";

export function isEqualRoot(config: IBeaconConfig, root1: Root, root2: Root): boolean {
  return config.types.Root.equals(root1, root2);
}

export function isZeroRoot(config: IBeaconConfig, root: Root): boolean {
  return isEqualRoot(config, root, ZERO_HASH);
}

export function isEqualNonZeroRoot(config: IBeaconConfig, root1: Root, root2: Root): boolean {
  return !isZeroRoot(config, root1) && !isZeroRoot(config, root2) && isEqualRoot(config, root1, root2);
}

/**
 * Typesafe wrapper around `String()`. The String constructor accepts any which is dangerous
 * @param num
 */
export function numToString(num: number): string {
  return String(num);
}

export function minEpoch(epochs: Epoch[]): Epoch | null {
  return epochs.length > 0 ? Math.min(...epochs) : null;
}
