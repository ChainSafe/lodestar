import {Slot, Version, Root, phase0, ForkDigest} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

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

export function epochToCurrentForkVersion(config: IBeaconConfig, slot: Slot): Version | null {
  let fork = config.params.GENESIS_FORK_VERSION;
  if (slot >= config.params.LIGHTCLIENT_PATCH_FORK_SLOT) {
    fork = config.params.LIGHTCLIENT_PATCH_FORK_VERSION;
  }
  return fork;
}
