import {ssz} from "@lodestar/types";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateEip7805, CachedBeaconStateGloas} from "../types.js";

/**
 * Upgrade a state from Fulu to Gloas.
 * TODO GLOAS: Implement this
 */
export function upgradeStateToGloas(stateEip7805: CachedBeaconStateEip7805): CachedBeaconStateGloas {
  const {config} = stateEip7805;

  const stateEip7805Node = ssz.eip7805.BeaconState.commitViewDU(stateEip7805);
  const stateGloasView = ssz.gloas.BeaconState.getViewDU(stateEip7805Node);

  const stateGloas = getCachedBeaconState(stateGloasView, stateEip7805);

  stateGloas.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateEip7805.fork.currentVersion,
    currentVersion: config.GLOAS_FORK_VERSION,
    epoch: stateEip7805.epochCtx.epoch,
  });

  stateGloas.commit();
  // Clear cache to ensure the cache of eip7805 fields is not used by new gloas fields
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateGloas["clearCache"]();

  return stateGloas;
}
