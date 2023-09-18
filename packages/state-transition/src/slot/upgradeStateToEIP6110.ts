import {ssz} from "@lodestar/types";
import {CachedBeaconStateDeneb} from "../types.js";
import {CachedBeaconStateEIP6110, getCachedBeaconState} from "../cache/stateCache.js";
import { UNSET_DEPOSIT_RECEIPTS_START_INDEX } from "@lodestar/params";

/**
 * Upgrade a state from Capella to Deneb.
 */
export function upgradeStateToEIP6110(stateDeneb: CachedBeaconStateDeneb): CachedBeaconStateEIP6110 {
  const {config} = stateDeneb;

  const stateEIP6110Node = ssz.deneb.BeaconState.commitViewDU(stateDeneb);
  const stateEIP6110View = ssz.eip6110.BeaconState.getViewDU(stateEIP6110Node);

  const stateEIP6110 = getCachedBeaconState(stateEIP6110View, stateDeneb);

  stateEIP6110.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateDeneb.fork.currentVersion,
    currentVersion: config.EIP6110_FORK_VERSION,
    epoch: stateDeneb.epochCtx.epoch,
  });



  // latestExecutionPayloadHeader's depositReceiptsRoot set to zeros by default
  // default value of depositReceiptsStartIndex is UNSET_DEPOSIT_RECEIPTS_START_INDEX
  stateEIP6110.depositReceiptsStartIndex = UNSET_DEPOSIT_RECEIPTS_START_INDEX;

  // Commit new added fields ViewDU to the root node
  stateEIP6110.commit();
  // Clear cache to ensure the cache of deneb fields is not used by new EIP6110 fields
  stateEIP6110["clearCache"]();

  return stateEIP6110;
}
