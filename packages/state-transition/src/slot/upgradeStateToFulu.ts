import {ssz} from "@lodestar/types";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateElectra, CachedBeaconStateFulu} from "../types.js";

/**
 * Upgrade a state from Electra to Fulu.
 */
export function upgradeStateToFulu(stateElectra: CachedBeaconStateElectra): CachedBeaconStateFulu {
  const {config} = stateElectra;

  const stateElectraNode = ssz.electra.BeaconState.commitViewDU(stateElectra);
  const stateFuluView = ssz.fulu.BeaconState.getViewDU(stateElectraNode);

  const stateFulu = getCachedBeaconState(stateFuluView, stateElectra);

  stateFulu.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateElectra.fork.currentVersion,
    currentVersion: config.FULU_FORK_VERSION,
    epoch: stateElectra.epochCtx.epoch,
  });

  stateFulu.commit();
  // Clear cache to ensure the cache of capella fields is not used by new deneb fields

  return stateFulu;
}
