import {ssz} from "@lodestar/types";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateDeneb} from "../types.js";
import {CachedBeaconStateElectra} from "../types.js";

/**
 * Upgrade a state from Capella to Deneb.
 */
export function upgradeStateToElectra(stateDeneb: CachedBeaconStateDeneb): CachedBeaconStateElectra {
  const {config} = stateDeneb;

  const stateDenebNode = ssz.deneb.BeaconState.commitViewDU(stateDeneb);
  const stateElectraView = ssz.electra.BeaconState.getViewDU(stateDenebNode);

  const stateElectra = getCachedBeaconState(stateElectraView, stateDeneb);

  stateElectra.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateDeneb.fork.currentVersion,
    currentVersion: config.ELECTRA_FORK_VERSION,
    epoch: stateDeneb.epochCtx.epoch,
  });

  // TODO ELECTRA: check if this is following is required, since it seemed to be an issue in deneb state u[grade
  // (see upgradeStateToDeneb)
  //
  // stateElectra.latestExecutionPayloadHeader = ssz.electra.BeaconState.fields.latestExecutionPayloadHeader.toViewDU({
  //   ...stateDeneb.latestExecutionPayloadHeader.toValue(),
  //   previousInclusionListSummaryRoot: ssz.Root.defaultValue(),
  // });

  stateElectra.commit();
  // Clear cache to ensure the cache of capella fields is not used by new deneb fields
  stateElectra["clearCache"]();

  return stateElectra;
}
