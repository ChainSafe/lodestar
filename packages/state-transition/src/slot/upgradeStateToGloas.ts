import {ssz} from "@lodestar/types";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateFulu, CachedBeaconStateGloas} from "../types.js";

/**
 * Upgrade a state from Fulu to Gloas.
 * TODO GLOAS: Implement this
 */
export function upgradeStateToGloas(stateFulu: CachedBeaconStateFulu): CachedBeaconStateGloas {
  const {config} = stateFulu;

  const stateFuluNode = ssz.fulu.BeaconState.commitViewDU(stateFulu);
  const stateGloasView = ssz.gloas.BeaconState.getViewDU(stateFuluNode);

  const stateGloas = getCachedBeaconState(stateGloasView, stateFulu);

  stateGloas.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateFulu.fork.currentVersion,
    currentVersion: config.GLOAS_FORK_VERSION,
    epoch: stateFulu.epochCtx.epoch,
  });

  stateGloas.commit();
  // Clear cache to ensure the cache of fulu fields is not used by new gloas fields
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateGloas["clearCache"]();

  return stateGloas;
}
