import {Version, Root, phase0, ForkDigest} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

/**
 * Used primarily in signature domains to avoid collisions across forks/chains.
 */
export function computeForkDataRoot(
  config: IBeaconConfig,
  currentVersion: Version,
  genesisValidatorsRoot: Root
): Uint8Array {
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
  return computeForkDataRoot(config, currentVersion, genesisValidatorsRoot).slice(0, 4);
}
