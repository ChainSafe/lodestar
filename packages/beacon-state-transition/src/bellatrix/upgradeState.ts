import {ssz} from "@chainsafe/lodestar-types";
import {CachedBeaconStateAltair, CachedBeaconStateBellatrix} from "../types.js";
import {getCachedBeaconState} from "../cache/stateCache.js";

/**
 * Upgrade a state from altair to bellatrix.
 */
export function upgradeState(stateAltair: CachedBeaconStateAltair): CachedBeaconStateBellatrix {
  const {config} = stateAltair;

  // Get underlying node and cast altair tree to bellatrix tree
  //
  // An altair BeaconState tree can be safely casted to a bellatrix BeaconState tree because:
  // - All new fields are appended at the end
  //
  // altair                        | op  | altair
  // ----------------------------- | --- | ------------
  // genesis_time                  | -   | genesis_time
  // genesis_validators_root       | -   | genesis_validators_root
  // slot                          | -   | slot
  // fork                          | -   | fork
  // latest_block_header           | -   | latest_block_header
  // block_roots                   | -   | block_roots
  // state_roots                   | -   | state_roots
  // historical_roots              | -   | historical_roots
  // eth1_data                     | -   | eth1_data
  // eth1_data_votes               | -   | eth1_data_votes
  // eth1_deposit_index            | -   | eth1_deposit_index
  // validators                    | -   | validators
  // balances                      | -   | balances
  // randao_mixes                  | -   | randao_mixes
  // slashings                     | -   | slashings
  // previous_epoch_participation  | -   | previous_epoch_participation
  // current_epoch_participation   | -   | current_epoch_participation
  // justification_bits            | -   | justification_bits
  // previous_justified_checkpoint | -   | previous_justified_checkpoint
  // current_justified_checkpoint  | -   | current_justified_checkpoint
  // finalized_checkpoint          | -   | finalized_checkpoint
  // inactivity_scores             | -   | inactivity_scores
  // current_sync_committee        | -   | current_sync_committee
  // next_sync_committee           | -   | next_sync_committee
  // -                             | new | latest_execution_payload_header

  const stateAltairNode = ssz.altair.BeaconState.commitViewDU(stateAltair);
  const stateBellatrixView = ssz.bellatrix.BeaconState.getViewDU(stateAltairNode);
  // Attach existing BeaconStateCache from stateAltair to new stateBellatrixView object
  const stateBellatrix = getCachedBeaconState(stateBellatrixView, stateAltair);

  stateBellatrix.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateAltair.fork.currentVersion,
    currentVersion: config.BELLATRIX_FORK_VERSION,
    epoch: stateAltair.epochCtx.epoch,
  });

  // Execution-layer
  stateBellatrix.latestExecutionPayloadHeader = ssz.bellatrix.ExecutionPayloadHeader.defaultViewDU();

  // Commit new added fields ViewDU to the root node
  stateBellatrix.commit();
  // No need to clear cache since no index is replaced, only appended at the end

  return stateBellatrix;
}
