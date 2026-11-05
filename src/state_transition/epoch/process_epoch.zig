const std = @import("std");
const metrics = @import("../metrics.zig");
const observeEpochTransitionStep = metrics.observeEpochTransitionStep;
const time = @import("time");
const processBuilderPendingPayments = @import("process_builder_pending_payments.zig").processBuilderPendingPayments;
const processPtcWindow = @import("process_ptc_window.zig").processPtcWindow;

const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const processJustificationAndFinalization = @import("./process_justification_and_finalization.zig").processJustificationAndFinalization;
const processInactivityUpdates = @import("./process_inactivity_updates.zig").processInactivityUpdates;
const processRegistryUpdates = @import("./process_registry_updates.zig").processRegistryUpdates;
const processSlashings = @import("./process_slashings.zig").processSlashings;
const processRewardsAndPenalties = @import("./process_rewards_and_penalties.zig").processRewardsAndPenalties;
const processEth1DataReset = @import("./process_eth1_data_reset.zig").processEth1DataReset;
const processPendingDeposits = @import("./process_pending_deposits.zig").processPendingDeposits;
const processPendingConsolidations = @import("./process_pending_consolidations.zig").processPendingConsolidations;
const processEffectiveBalanceUpdates = @import("./process_effective_balance_updates.zig").processEffectiveBalanceUpdates;
const processSlashingsReset = @import("./process_slashings_reset.zig").processSlashingsReset;
const processRandaoMixesReset = @import("./process_randao_mixes_reset.zig").processRandaoMixesReset;
const processHistoricalSummariesUpdate = @import("./process_historical_summaries_update.zig").processHistoricalSummariesUpdate;
const processHistoricalRootsUpdate = @import("./process_historical_roots_update.zig").processHistoricalRootsUpdate;
const processParticipationRecordUpdates = @import("./process_participation_record_updates.zig").processParticipationRecordUpdates;
const processParticipationFlagUpdates = @import("./process_participation_flag_updates.zig").processParticipationFlagUpdates;
const processSyncCommitteeUpdates = @import("./process_sync_committee_updates.zig").processSyncCommitteeUpdates;
const processProposerLookahead = @import("./process_proposer_lookahead.zig").processProposerLookahead;
const startProposerLookaheadShuffling = @import("./process_proposer_lookahead.zig").startProposerLookaheadShuffling;

pub fn processEpoch(
    comptime fork: ForkSeq,
    allocator: std.mem.Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    cache: *EpochTransitionCache,
) !void {
    if (comptime fork.gte(.fulu)) {
        try startProposerLookaheadShuffling(fork, io, epoch_cache, state, cache);
    }

    var timer = time.start(io);
    try processJustificationAndFinalization(fork, state, cache);
    try observeEpochTransitionStep(.{ .step = .process_justification_and_finalization }, @as(u64, @intCast(time.since(io, timer).nanoseconds)));

    if (comptime fork.gte(.altair)) {
        timer = time.start(io);
        try processInactivityUpdates(fork, allocator, config, epoch_cache, state, cache);
        try observeEpochTransitionStep(.{ .step = .process_inactivity_updates }, @as(u64, @intCast(time.since(io, timer).nanoseconds)));
    }

    metrics.state_transition.validators_in_activation_queue.set(@intCast(cache.indices_eligible_for_activation_queue.items.len));
    metrics.state_transition.validators_in_exit_queue.set(@intCast(cache.indices_to_eject.items.len));
    timer = time.start(io);
    try processRegistryUpdates(fork, config, epoch_cache, state, cache);
    try observeEpochTransitionStep(.{ .step = .process_registry_updates }, @as(u64, @intCast(time.since(io, timer).nanoseconds)));

    timer = time.start(io);
    const slashing_penalties = try processSlashings(fork, epoch_cache, state, cache, false);
    try observeEpochTransitionStep(.{ .step = .process_slashings }, @as(u64, @intCast(time.since(io, timer).nanoseconds)));

    timer = time.start(io);
    try processRewardsAndPenalties(fork, io, config, epoch_cache, state, cache, slashing_penalties);
    try observeEpochTransitionStep(.{ .step = .process_rewards_and_penalties }, @as(u64, @intCast(time.since(io, timer).nanoseconds)));

    if (comptime fork.lt(.heze)) try processEth1DataReset(fork, state, cache);

    if (comptime fork.gte(.electra)) {
        timer = time.start(io);
        try processPendingDeposits(fork, allocator, io, config, epoch_cache, state, cache);
        try observeEpochTransitionStep(.{ .step = .process_pending_deposits }, @as(u64, @intCast(time.since(io, timer).nanoseconds)));

        timer = time.start(io);
        try processPendingConsolidations(fork, epoch_cache, state, cache);
        try observeEpochTransitionStep(.{ .step = .process_pending_consolidations }, @as(u64, @intCast(time.since(io, timer).nanoseconds)));
    }

    if (comptime fork.gte(.gloas)) {
        try processBuilderPendingPayments(fork, allocator, state, epoch_cache);
    }

    timer = time.start(io);
    const num_update = try processEffectiveBalanceUpdates(fork, allocator, epoch_cache, state, cache);
    try observeEpochTransitionStep(.{ .step = .process_effective_balance_updates }, @as(u64, @intCast(time.since(io, timer).nanoseconds)));
    metrics.state_transition.num_effective_balance_updates.set(@intCast(num_update));

    try processSlashingsReset(fork, epoch_cache, state, cache);
    try processRandaoMixesReset(fork, state, cache);

    if (comptime fork.gte(.capella)) {
        try processHistoricalSummariesUpdate(fork, state, cache);
    } else {
        try processHistoricalRootsUpdate(fork, state, cache);
    }

    if (comptime fork == .phase0) {
        try processParticipationRecordUpdates(fork, state);
    } else {
        timer = time.start(io);
        try processParticipationFlagUpdates(fork, state);
        try observeEpochTransitionStep(.{ .step = .process_participation_flag_updates }, @as(u64, @intCast(time.since(io, timer).nanoseconds)));
    }

    if (comptime fork.gte(.altair)) {
        timer = time.start(io);
        try processSyncCommitteeUpdates(fork, allocator, io, epoch_cache, state);
        try observeEpochTransitionStep(.{ .step = .process_sync_committee_updates }, @as(u64, @intCast(time.since(io, timer).nanoseconds)));
    }

    if (comptime fork.gte(.fulu)) {
        timer = time.start(io);
        try processProposerLookahead(fork, allocator, epoch_cache, state, cache);
        try observeEpochTransitionStep(.{ .step = .process_proposer_lookahead }, @as(u64, @intCast(time.since(io, timer).nanoseconds)));
    }
    if (comptime fork.gte(.gloas)) {
        try processPtcWindow(fork, allocator, epoch_cache, state, cache);
    }
}
