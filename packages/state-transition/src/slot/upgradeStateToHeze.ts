import {ssz} from "@lodestar/types";
import {CachedBeaconStateGloas, CachedBeaconStateHeze, getCachedBeaconState} from "../cache/stateCache.js";

/**
 * Upgrade a state from Gloas to Heze.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/master/specs/heze/fork.md
 */
export function upgradeStateToHeze(stateGloas: CachedBeaconStateGloas): CachedBeaconStateHeze {
  const {config} = stateGloas;

  const stateGloasNode = ssz.gloas.BeaconState.commitViewDU(stateGloas);
  const stateHezeView = ssz.heze.BeaconState.getViewDU(stateGloasNode);
  const stateHeze = getCachedBeaconState(stateHezeView, stateGloas);

  stateHeze.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateGloas.fork.currentVersion,
    currentVersion: config.HEZE_FORK_VERSION,
    epoch: stateGloas.epochCtx.epoch,
  });

  // Commit new added fields ViewDU to the root node
  stateHeze.commit();
  // No need to clear cache since no index is replaced, only appended at the end
  return stateHeze;
}
