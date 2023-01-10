import {ssz} from "@lodestar/types";
import {CachedBeaconStateBellatrix, CachedBeaconStateCapella} from "../types.js";
import {getCachedBeaconState} from "../cache/stateCache.js";

/**
 * Upgrade a state from bellatrix to capella.
 */
export function upgradeStateToCapella(stateBellatrix: CachedBeaconStateBellatrix): CachedBeaconStateCapella {
  const {config} = stateBellatrix;

  // Get underlying node and cast bellatrix tree to capella tree
  //
  // An bellatrix BeaconState tree can be safely casted to a capella BeaconState tree because:
  // - Deprecated fields are replaced by new fields at the exact same indexes
  // - All new fields are appended at the end
  //
  // bellatrix                        | op    | capella
  // -------------------------------- | ----  | ------------
  // genesis_time                     | -     | genesis_time
  // genesis_validators_root          | -     | genesis_validators_root
  // slot                             | -     | slot
  // fork                             | -     | fork
  // latest_block_header              | -     | latest_block_header
  // block_roots                      | -     | block_roots
  // state_roots                      | -     | state_roots
  // historical_roots                 | frozen| historical_roots
  // eth1_data                        | -     | eth1_data
  // eth1_data_votes                  | -     | eth1_data_votes
  // eth1_deposit_index               | -     | eth1_deposit_index
  // validators                       | -     | validators
  // balances                         | -     | balances
  // randao_mixes                     | -     | randao_mixes
  // slashings                        | -     | slashings
  // previous_epoch_participation     | -     | previous_epoch_participation
  // current_epoch_participation      | -     | current_epoch_participation
  // justification_bits               | -     | justification_bits
  // previous_justified_checkpoint    | -     | previous_justified_checkpoint
  // current_justified_checkpoint     | -     | current_justified_checkpoint
  // finalized_checkpoint             | -     | finalized_checkpoint
  // inactivity_scores                | -     | inactivity_scores
  // current_sync_committee           | -     | current_sync_committee
  // next_sync_committee              | -     | next_sync_committee
  // latest_execution_payload_header  | diff  | latest_execution_payload_header
  // -                                | new   | next_withdrawal_index
  // -                                | new   | next_withdrawal_validator_index
  // -                                | new   | historical_summaries

  const stateBellatrixNode = ssz.bellatrix.BeaconState.commitViewDU(stateBellatrix);
  const stateCapellaView = ssz.capella.BeaconState.getViewDU(stateBellatrixNode);
  // Attach existing BeaconStateCache from stateBellatrix to new stateCapellaView object
  const stateCapella = getCachedBeaconState(stateCapellaView, stateBellatrix);

  stateCapella.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateBellatrix.fork.currentVersion,
    currentVersion: config.CAPELLA_FORK_VERSION,
    epoch: stateBellatrix.epochCtx.epoch,
  });

  // nextWithdrawalIndex and nextWithdrawalValidatorIndex are already set to 0 by default
  // latestExecutionPayloadHeader's withdrawalRoot set to zeros by default
  // historicalRoots should be cloned over already and historicalSummaries need to be default []
  stateCapella.historicalSummaries = ssz.capella.BeaconState.fields.historicalSummaries.defaultViewDU();

  // Commit new added fields ViewDU to the root node
  stateCapella.commit();
  // Clear cache to ensure the cache of bellatrix fields is not used by new capella fields
  stateCapella["clearCache"]();

  return stateCapella;
}
