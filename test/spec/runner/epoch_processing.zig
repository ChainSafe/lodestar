const Node = @import("persistent_merkle_tree").Node;
const ForkSeq = @import("config").ForkSeq;
const active_preset = @import("preset").active_preset;
const std = @import("std");
const state_transition = @import("state_transition");
const TestCachedBeaconState = state_transition.test_utils.TestCachedBeaconState;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const EpochTransitionCache = state_transition.EpochTransitionCache;
const test_case = @import("../test_case.zig");
const TestCaseUtils = test_case.TestCaseUtils;
const expectEqualBeaconStates = test_case.expectEqualBeaconStates;

pub const EpochProcessingFn = enum {
    effective_balance_updates,
    eth1_data_reset,
    historical_roots_update,
    inactivity_updates,
    justification_and_finalization,
    participation_flag_updates,
    participation_record_updates,
    randao_mixes_reset,
    registry_updates,
    rewards_and_penalties,
    slashings,
    slashings_reset,
    sync_committee_updates,
    historical_summaries_update,
    pending_deposits,
    pending_deposits_churn,
    pending_consolidations,
    proposer_lookahead,
    builder_pending_payments,
    ptc_window,

    pub fn suiteName(self: EpochProcessingFn) []const u8 {
        return @tagName(self) ++ "/pyspec_tests";
    }
};

pub fn TestCase(comptime fork: ForkSeq, comptime epoch_process_fn: EpochProcessingFn) type {
    const tc_utils = TestCaseUtils(fork);

    return struct {
        pre: TestCachedBeaconState,
        // a null post state means the test is expected to fail
        post: ?*AnyBeaconState,

        const Self = @This();

        pub fn execute(allocator: std.mem.Allocator, dir: std.Io.Dir) !void {
            const pool_size = if (active_preset == .mainnet) 10_000_000 else 1_000_000;
            var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
            defer pool.deinit();

            var tc = try Self.init(allocator, &pool, dir);
            defer tc.deinit();

            try tc.runTest();
        }

        pub fn init(allocator: std.mem.Allocator, pool: *Node.Pool, dir: std.Io.Dir) !Self {
            var tc = Self{
                .pre = undefined,
                .post = undefined,
            };

            // load pre state
            tc.pre = try tc_utils.loadPreState(allocator, pool, dir);
            errdefer tc.pre.deinit();

            // load pre state
            tc.post = try tc_utils.loadPostState(allocator, pool, dir);

            return tc;
        }

        pub fn deinit(self: *Self) void {
            self.pre.deinit();
            if (self.post) |post| {
                post.deinit();
                self.pre.allocator.destroy(post);
            }
            state_transition.deinitReusedEpochTransitionCache();
        }

        fn runTest(self: *Self) !void {
            if (self.post) |post| {
                try self.process();
                try expectEqualBeaconStates(post, self.pre.cached_state.state);
            } else {
                self.process() catch |err| {
                    return test_case.expectConsensusInvalid(err);
                };
                return error.ExpectedError;
            }
        }

        fn process(self: *Self) !void {
            const allocator = self.pre.allocator;
            const cached_state = self.pre.cached_state;
            const config = cached_state.config;
            const epoch_cache = cached_state.epoch_cache;
            const state = cached_state.state;

            var epoch_transition_cache = try EpochTransitionCache.init(
                allocator,
                config,
                epoch_cache,
                state,
            );
            defer epoch_transition_cache.deinit();

            const fork_state = state.castToFork(fork);

            switch (epoch_process_fn) {
                .effective_balance_updates => _ = try state_transition.processEffectiveBalanceUpdates(fork, allocator, epoch_cache, fork_state, &epoch_transition_cache),
                .eth1_data_reset => try state_transition.processEth1DataReset(fork, fork_state, &epoch_transition_cache),
                .historical_roots_update => try state_transition.processHistoricalRootsUpdate(fork, fork_state, &epoch_transition_cache),
                .inactivity_updates => try state_transition.processInactivityUpdates(fork, allocator, config, epoch_cache, fork_state, &epoch_transition_cache),
                .justification_and_finalization => try state_transition.processJustificationAndFinalization(fork, fork_state, &epoch_transition_cache),
                .participation_flag_updates => try state_transition.processParticipationFlagUpdates(fork, fork_state),
                .participation_record_updates => try state_transition.processParticipationRecordUpdates(fork, fork_state),
                .randao_mixes_reset => try state_transition.processRandaoMixesReset(fork, fork_state, &epoch_transition_cache),
                .registry_updates => try state_transition.processRegistryUpdates(fork, config, epoch_cache, fork_state, &epoch_transition_cache),
                .rewards_and_penalties => try state_transition.processRewardsAndPenalties(fork, std.testing.io, config, epoch_cache, fork_state, &epoch_transition_cache, null),
                .slashings => _ = try state_transition.processSlashings(fork, epoch_cache, fork_state, &epoch_transition_cache, true),
                .slashings_reset => try state_transition.processSlashingsReset(fork, epoch_cache, fork_state, &epoch_transition_cache),
                .sync_committee_updates => try state_transition.processSyncCommitteeUpdates(fork, allocator, std.testing.io, epoch_cache, fork_state),
                .historical_summaries_update => try state_transition.processHistoricalSummariesUpdate(fork, fork_state, &epoch_transition_cache),
                .pending_deposits, .pending_deposits_churn => try state_transition.processPendingDeposits(fork, allocator, std.testing.io, config, epoch_cache, fork_state, &epoch_transition_cache),
                .pending_consolidations => try state_transition.processPendingConsolidations(fork, epoch_cache, fork_state, &epoch_transition_cache),
                .proposer_lookahead => {
                    try state_transition.processProposerLookahead(fork, allocator, epoch_cache, fork_state, &epoch_transition_cache);
                },
                .builder_pending_payments => try state_transition.processBuilderPendingPayments(fork, allocator, fork_state, epoch_cache),
                .ptc_window => try state_transition.processPtcWindow(fork, allocator, epoch_cache, fork_state, &epoch_transition_cache),
            }
        }
    };
}
