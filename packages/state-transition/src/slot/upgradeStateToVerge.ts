import {ssz} from "@lodestar/types";
import {CachedBeaconStateDeneb, CachedBeaconStateVerge} from "../types.js";
import {getCachedBeaconState} from "../cache/stateCache.js";

/**
 * Upgrade a state from Deneb to Verge.
 */
export function upgradeStateToVerge(stateDeneb: CachedBeaconStateDeneb): CachedBeaconStateVerge {
  const {config} = stateDeneb;

  const stateDenebNode = ssz.deneb.BeaconState.commitViewDU(stateDeneb);
  const stateVergeView = ssz.verge.BeaconState.getViewDU(stateDenebNode);

  const stateVerge = getCachedBeaconState(stateVergeView, stateDeneb);

  stateVerge.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateDeneb.fork.currentVersion,
    currentVersion: config.DENEB_FORK_VERSION,
    epoch: stateDeneb.epochCtx.epoch,
  });

  // latestExecutionPayloadHeader's executionWitnessRoot will have default zero root

  stateVerge.commit();
  return stateVerge;
}
