import {Version, Root, ForkData, ForkDigest, Epoch} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {intToBytes} from "@chainsafe/lodestar-utils";

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

export function epochToCurrentForkVersion(config: IBeaconConfig, epoch: Epoch): Version | null {
  const forks = config.params.ALL_FORKS;
  for (const fork of forks) {
    if (epoch < fork.epoch) {
      return intToBytes(fork.previousVersion, 4, "le");
    }
  }
  //epoch is beyond last known fork checkpoint, take current version of last fork
  return intToBytes(forks[forks.length - 1].currentVersion, 4, "le");
}
