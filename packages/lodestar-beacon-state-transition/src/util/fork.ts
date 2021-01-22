import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ForkData, ForkDigest, Root, Slot, Version} from "@chainsafe/lodestar-types";
import { LIGHTCLIENT_PATCH_FORK_SLOT, LIGHTCLIENT_PATCH_FORK_VERSION } from "../lightclient";

/**
 * Used primarily in signature domains to avoid collisions across forks/chains.
 */
export function computeForkDataRoot(config: IBeaconConfig, currentVersion: Version, genesisValidatorsRoot: Root): Root {
  const forkData: ForkData = {
    currentVersion,
    genesisValidatorsRoot,
  };
  return config.types.ForkData.hashTreeRoot(forkData);
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
  if (slot >= LIGHTCLIENT_PATCH_FORK_SLOT) {
    fork = LIGHTCLIENT_PATCH_FORK_VERSION;
  }
  return fork;
}
