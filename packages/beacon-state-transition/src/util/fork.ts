import {Version, Root, phase0, ForkDigest, ssz} from "@chainsafe/lodestar-types";

/**
 * Used primarily in signature domains to avoid collisions across forks/chains.
 */
export function computeForkDataRoot(currentVersion: Version, genesisValidatorsRoot: Root): Uint8Array {
  const forkData: phase0.ForkData = {
    currentVersion,
    genesisValidatorsRoot,
  };
  return ssz.phase0.ForkData.hashTreeRoot(forkData);
}

export function computeForkDigest(currentVersion: Version, genesisValidatorsRoot: Root): ForkDigest {
  return computeForkDataRoot(currentVersion, genesisValidatorsRoot).slice(0, 4);
}
