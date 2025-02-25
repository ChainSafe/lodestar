import {ssz} from "@lodestar/types";
import {CachedBeaconStateElectra, CachedBeaconStateFulu, getCachedBeaconState} from "../cache/stateCache.js";

/**
 * Upgrade a state from Deneb to Electra.
 */
export function upgradeStateToFulu(stateElectra: CachedBeaconStateElectra): CachedBeaconStateFulu {
  const {config} = stateElectra;

  const stateElectraNode = ssz.electra.BeaconState.commitViewDU(stateElectra);
  const stateFuluView = ssz.fulu.BeaconState.getViewDU(stateElectraNode);
  // Attach existing BeaconStateCache from stateAltair to new stateBellatrixView object
  const stateFulu = getCachedBeaconState(stateFuluView, stateElectra);

  stateFulu.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateElectra.fork.currentVersion,
    currentVersion: config.FULU_FORK_VERSION,
    epoch: stateElectra.epochCtx.epoch,
  });

  // Commit new added fields ViewDU to the root node
  stateFulu.commit();
  // No need to clear cache since no index is replaced, only appended at the end
  return stateFulu;
}
