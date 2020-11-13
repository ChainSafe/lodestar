import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, Root} from "@chainsafe/lodestar-types";
import {fromHexString, toHexString, Vector} from "@chainsafe/ssz";

export const blsPubkeyLen = 48;

export function getZeroRoot(config: IBeaconConfig): Root {
  return config.types.Root.defaultValue();
}

export function isEqualRoot(config: IBeaconConfig, root1: Root, root2: Root): boolean {
  return config.types.Root.equals(root1, root2);
}

export function isEqualNonZeroRoot(config: IBeaconConfig, root1: Root, root2: Root): boolean {
  const ZERO_ROOT = getZeroRoot(config);
  return (
    !isEqualRoot(config, root1, ZERO_ROOT) &&
    !isEqualRoot(config, root2, ZERO_ROOT) &&
    isEqualRoot(config, root1, root2)
  );
}

export function fromOptionalHexString(config: IBeaconConfig, hex: string | undefined): Root {
  return hex ? fromHexString(hex) : getZeroRoot(config);
}

export function toOptionalHexString(config: IBeaconConfig, root: Root): string | undefined {
  const ZERO_ROOT = getZeroRoot(config);
  return isEqualRoot(config, root, ZERO_ROOT) ? undefined : toHexString(root);
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

export function uniqueVectorArr(buffers: Vector<number>[]): Vector<number>[] {
  const bufferStr = new Set<string>();
  return buffers.filter((buffer) => {
    const str = toHexString(buffer);
    const seen = bufferStr.has(str);
    bufferStr.add(str);
    return !seen;
  });
}
