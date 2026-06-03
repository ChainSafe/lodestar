import {UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateElectra, CachedBeaconStateFulu} from "../types.js";
import {initializeProposerLookahead} from "../util/fulu.js";

/**
 * Upgrade a state from Electra to Fulu.
 */
export function upgradeStateToFulu(stateElectra: CachedBeaconStateElectra): CachedBeaconStateFulu {
  const {config} = stateElectra;

  // [Modified in Fulu:EIP6110] Legacy eth1 bridge deposits are removed in Fulu. If no Electra
  // deposit_request set `deposit_requests_start_index`, mark the bridge cutover as complete at
  // the boundary so post-Fulu `process_pending_deposits` (which no longer gates on the bridge
  // index) sees a consistent state. Mirrors consensus-specs #4704 do_fork helper.
  if (stateElectra.depositRequestsStartIndex === UNSET_DEPOSIT_REQUESTS_START_INDEX) {
    stateElectra.depositRequestsStartIndex = BigInt(stateElectra.eth1Data.depositCount);
  }

  const stateElectraNode = ssz.electra.BeaconState.commitViewDU(stateElectra);
  const stateFuluView = ssz.fulu.BeaconState.getViewDU(stateElectraNode);

  const stateFulu = getCachedBeaconState(stateFuluView, stateElectra);

  stateFulu.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateElectra.fork.currentVersion,
    currentVersion: config.FULU_FORK_VERSION,
    epoch: stateElectra.epochCtx.epoch,
  });

  stateFulu.proposerLookahead = ssz.fulu.ProposerLookahead.toViewDU(initializeProposerLookahead(stateElectra));

  stateFulu.commit();
  // Clear cache to ensure the cache of electra fields is not used by new fulu fields
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateFulu["clearCache"]();

  return stateFulu;
}
