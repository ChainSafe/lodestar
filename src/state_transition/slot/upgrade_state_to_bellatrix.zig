const std = @import("std");
const BeaconConfig = @import("config").BeaconConfig;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const BeaconState = @import("fork_types").BeaconState;
const ct = @import("consensus_types");

pub fn upgradeStateToBellatrix(
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    altair_state: *BeaconState(.altair),
) !BeaconState(.bellatrix) {

    // Get underlying node and cast altair tree to bellatrix tree
    //
    // An altair BeaconState tree can be safely casted to a bellatrix BeaconState tree because:
    // - All new fields are appended at the end
    //
    // altair                        | op  | bellatrix
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

    var state = try altair_state.upgradeUnsafe();
    errdefer state.deinit();

    const new_fork: ct.phase0.Fork.Type = .{
        .previous_version = try altair_state.forkCurrentVersion(),
        .current_version = config.chain.BELLATRIX_FORK_VERSION,
        .epoch = epoch_cache.epoch,
    };
    try state.setFork(&new_fork);

    altair_state.deinit();
    return state;
}
