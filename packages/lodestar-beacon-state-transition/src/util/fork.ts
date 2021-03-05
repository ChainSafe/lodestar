import {Version, Root, phase0, ForkDigest} from "@chainsafe/lodestar-types";
import {IBeaconConfig, IForkName} from "@chainsafe/lodestar-config";
import {byteArrayEquals, toHexString} from "@chainsafe/ssz";

/**
 * Used primarily in signature domains to avoid collisions across forks/chains.
 */
export function computeForkDataRoot(config: IBeaconConfig, currentVersion: Version, genesisValidatorsRoot: Root): Root {
  const forkData: phase0.ForkData = {
    currentVersion,
    genesisValidatorsRoot,
  };
  return config.types.phase0.ForkData.hashTreeRoot(forkData);
}

export function computeForkDigest(
  config: IBeaconConfig,
  currentVersion: Version,
  genesisValidatorsRoot: Root
): ForkDigest {
  const root = computeForkDataRoot(config, currentVersion, genesisValidatorsRoot);
  return (root.valueOf() as Uint8Array).slice(0, 4);
}

export function computeForkNameFromForkDigest(
  config: IBeaconConfig,
  genesisValidatorsRoot: Root,
  forkDigest: ForkDigest
): IForkName {
  for (const {name, version} of Object.values(config.getForkInfoRecord())) {
    if (
      byteArrayEquals(forkDigest as Uint8Array, computeForkDigest(config, version, genesisValidatorsRoot) as Uint8Array)
    ) {
      return name;
    }
  }
  throw new Error(`No known fork for fork digest: ${toHexString(forkDigest)}`);
}
