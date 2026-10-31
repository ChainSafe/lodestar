const Allocator = @import("std").mem.Allocator;
const BeaconConfig = @import("config").BeaconConfig;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const ct = @import("consensus_types");
const ValidatorIndex = ct.primitive.ValidatorIndex.Type;
const preset = @import("preset").preset;
const c = @import("constants");
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const seed_utils = @import("../utils/seed.zig");
const getSeed = seed_utils.getSeed;
const computeProposers = seed_utils.computeProposers;

pub fn upgradeStateToFulu(
    allocator: Allocator,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    electra_state: *BeaconState(.electra),
) !BeaconState(.fulu) {
    var state = try electra_state.upgradeUnsafe();
    errdefer state.deinit();

    // Update fork version
    const new_fork = ct.phase0.Fork.Type{
        .previous_version = try electra_state.forkCurrentVersion(),
        .current_version = config.chain.FULU_FORK_VERSION,
        .epoch = epoch_cache.epoch,
    };
    try state.setFork(&new_fork);

    var proposer_lookahead = ct.fulu.ProposerLookahead.default_value;
    try initializeProposerLookahead(
        .fulu,
        allocator,
        epoch_cache,
        &state,
        proposer_lookahead[0..],
    );
    try state.setProposerLookahead(&proposer_lookahead);

    electra_state.deinit();
    return state;
}

/// Initializes `proposer_lookahead` during the Electra -> Fulu upgrade.
/// Fills the `proposer_lookahead` field with `(MIN_SEED_LOOKAHEAD + 1)` epochs worth of proposer indices.
/// Uses active indices from the epoch cache shufflings.
fn initializeProposerLookahead(
    comptime fork: ForkSeq,
    allocator: Allocator,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    out: []ValidatorIndex,
) !void {
    const lookahead_epochs = preset.MIN_SEED_LOOKAHEAD + 1;
    const expected_len = lookahead_epochs * preset.SLOTS_PER_EPOCH;
    if (out.len != expected_len) return error.InvalidProposerLookaheadLength;

    const current_epoch = epoch_cache.epoch;
    const effective_balance_increments = epoch_cache.getEffectiveBalanceIncrements();

    // Fill proposer_lookahead with current epoch through current_epoch + MIN_SEED_LOOKAHEAD
    for (0..lookahead_epochs) |i| {
        const epoch = current_epoch + i;
        const offset = i * preset.SLOTS_PER_EPOCH;

        // Get active indices from the epoch cache
        const active_indices = epoch_cache.getActiveIndicesAtEpoch(epoch) orelse return error.ActiveIndicesNotFound;

        var seed: [32]u8 = undefined;
        try getSeed(fork, state, epoch, c.DOMAIN_BEACON_PROPOSER, &seed);

        try computeProposers(
            fork,
            allocator,
            seed,
            epoch,
            active_indices,
            effective_balance_increments,
            out[offset .. offset + preset.SLOTS_PER_EPOCH],
        );
    }
}
