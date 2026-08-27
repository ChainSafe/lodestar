import {ssz} from "@lodestar/types";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateEip8198, CachedBeaconStateGloas} from "../types.js";

/**
 * Upgrade a state from Gloas to EIP-8198. No state fields change, only the fork version.
 */
export function upgradeStateToEip8198(stateGloas: CachedBeaconStateGloas): CachedBeaconStateEip8198 {
  const {config} = stateGloas;
  const stateGloasNode = ssz.gloas.BeaconState.commitViewDU(stateGloas);
  const stateEip8198View = ssz.eip8198.BeaconState.getViewDU(stateGloasNode);
  const stateEip8198 = getCachedBeaconState(stateEip8198View, stateGloas);

  stateEip8198.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateGloas.fork.currentVersion,
    currentVersion: config.EIP8198_FORK_VERSION,
    epoch: stateGloas.epochCtx.epoch,
  });

  stateEip8198.commit();
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateEip8198["clearCache"]();

  return stateEip8198;
}
