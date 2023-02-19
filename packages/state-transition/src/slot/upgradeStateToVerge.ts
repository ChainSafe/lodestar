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
    currentVersion: config.EIP4844_FORK_VERSION,
    epoch: stateDeneb.epochCtx.epoch,
  });

  // Initialize ExecutionWitness empty List
  stateVerge.latestExecutionPayloadHeader.executionWitness = ssz.verge.ExecutionWitness.defaultViewDU();

  stateVerge.commit();

  return stateVerge;
}
