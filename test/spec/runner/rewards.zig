const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const ct = @import("consensus_types");
const ssz = @import("ssz");
const ForkSeq = @import("config").ForkSeq;
const state_transition = @import("state_transition");
const TestCachedBeaconState = state_transition.test_utils.TestCachedBeaconState;
const TestCaseUtils = @import("../test_case.zig").TestCaseUtils;
const loadSszValue = @import("../test_case.zig").loadSszSnappyValue;

const EpochTransitionCache = state_transition.EpochTransitionCache;
const getRewardsAndPenaltiesFn = state_transition.getRewardsAndPenalties;

const preset = @import("preset").preset;
const active_preset = @import("preset").active_preset;

pub const Handler = enum {
    basic,
    leak,
    random,
    inactivity_scores,

    pub inline fn suiteName(comptime self: Handler) []const u8 {
        return @tagName(self) ++ "/pyspec_tests";
    }
};

pub fn TestCase(comptime fork: ForkSeq) type {
    const Balances = ssz.FixedListType(ct.primitive.Gwei, preset.VALIDATOR_REGISTRY_LIMIT, .{});
    const DeltasType = ssz.VariableVectorType(Balances, 2);
    const tc_utils = TestCaseUtils(fork);

    return struct {
        pre: TestCachedBeaconState,
        expected_rewards: []u64,
        expected_penalties: []u64,
        actual_rewards: []u64,
        actual_penalties: []u64,

        const Self = @This();

        pub fn execute(allocator: std.mem.Allocator, dir: std.Io.Dir) !void {
            const pool_size = if (active_preset == .mainnet) 10_000_000 else 1_000_000;
            var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
            defer pool.deinit();

            var tc = try Self.init(allocator, &pool, dir);
            defer {
                tc.deinit();
                state_transition.deinitReusedEpochTransitionCache();
            }

            try tc.runTest();
        }

        fn init(allocator: std.mem.Allocator, pool: *Node.Pool, dir: std.Io.Dir) !Self {
            var pre_state = try tc_utils.loadPreState(allocator, pool, dir);
            errdefer pre_state.deinit();

            const cache_allocator = pre_state.allocator;
            const validator_count = try pre_state.cached_state.state.validatorsCount();
            const expected = try Self.buildExpectedRewardsPenalties(cache_allocator, dir, validator_count);

            return .{
                .pre = pre_state,
                .expected_rewards = expected.rewards,
                .expected_penalties = expected.penalties,
                .actual_rewards = undefined,
                .actual_penalties = undefined,
            };
        }

        fn deinit(self: *Self) void {
            const allocator = self.pre.allocator;
            allocator.free(self.expected_rewards);
            allocator.free(self.expected_penalties);
            self.pre.deinit();
        }

        fn buildExpectedRewardsPenalties(
            allocator: std.mem.Allocator,
            dir: std.Io.Dir,
            validator_count: usize,
        ) !struct { rewards: []u64, penalties: []u64 } {
            const expected_rewards = try allocator.alloc(u64, validator_count);
            errdefer allocator.free(expected_rewards);
            const expected_penalties = try allocator.alloc(u64, validator_count);
            errdefer allocator.free(expected_penalties);

            @memset(expected_rewards, 0);
            @memset(expected_penalties, 0);

            try Self.accumulateFromFile(expected_rewards, expected_penalties, allocator, dir, "source_deltas.ssz_snappy");
            try Self.accumulateFromFile(expected_rewards, expected_penalties, allocator, dir, "target_deltas.ssz_snappy");
            try Self.accumulateFromFile(expected_rewards, expected_penalties, allocator, dir, "head_deltas.ssz_snappy");
            try Self.accumulateFromOptionalFile(expected_rewards, expected_penalties, allocator, dir, "inclusion_delay_deltas.ssz_snappy");
            try Self.accumulateFromFile(expected_rewards, expected_penalties, allocator, dir, "inactivity_penalty_deltas.ssz_snappy");

            return .{ .rewards = expected_rewards, .penalties = expected_penalties };
        }

        fn accumulateFromFile(
            expected_rewards: []u64,
            expected_penalties: []u64,
            allocator: std.mem.Allocator,
            dir: std.Io.Dir,
            comptime filename: []const u8,
        ) !void {
            var deltas = try Self.loadDeltas(allocator, dir, filename);
            defer DeltasType.deinit(allocator, &deltas);
            try Self.accumulateDeltas(expected_rewards, expected_penalties, &deltas);
        }

        fn accumulateFromOptionalFile(
            expected_rewards: []u64,
            expected_penalties: []u64,
            allocator: std.mem.Allocator,
            dir: std.Io.Dir,
            comptime filename: []const u8,
        ) !void {
            if (try Self.loadOptionalDeltas(allocator, dir, filename)) |deltas_value| {
                var deltas = deltas_value;
                defer DeltasType.deinit(allocator, &deltas);
                try Self.accumulateDeltas(expected_rewards, expected_penalties, &deltas);
            }
        }

        fn loadDeltas(
            allocator: std.mem.Allocator,
            dir: std.Io.Dir,
            comptime filename: []const u8,
        ) !DeltasType.Type {
            var deltas = DeltasType.default_value;
            errdefer {
                if (comptime @hasDecl(DeltasType, "deinit")) {
                    DeltasType.deinit(allocator, &deltas);
                }
            }
            try loadSszValue(DeltasType, allocator, dir, filename, &deltas);
            return deltas;
        }

        fn loadOptionalDeltas(
            allocator: std.mem.Allocator,
            dir: std.Io.Dir,
            comptime filename: []const u8,
        ) !?DeltasType.Type {
            var deltas = DeltasType.default_value;
            errdefer {
                if (comptime @hasDecl(DeltasType, "deinit")) {
                    DeltasType.deinit(allocator, &deltas);
                }
            }
            loadSszValue(DeltasType, allocator, dir, filename, &deltas) catch |err| switch (err) {
                error.FileNotFound => return null,
                else => return err,
            };
            return deltas;
        }

        fn runTest(self: *Self) !void {
            try self.process();
            try std.testing.expectEqualSlices(u64, self.expected_rewards, self.actual_rewards);
            try std.testing.expectEqualSlices(u64, self.expected_penalties, self.actual_penalties);
        }

        fn process(self: *Self) !void {
            const allocator = self.pre.allocator;
            const cloned_state = try self.pre.cached_state.clone(allocator, .{ .transfer_cache = false });
            defer {
                cloned_state.deinit();
                allocator.destroy(cloned_state);
            }

            var epoch_transition_cache = try EpochTransitionCache.init(
                allocator,
                cloned_state.config,
                cloned_state.epoch_cache,
                cloned_state.state,
            );
            defer epoch_transition_cache.deinit();

            try getRewardsAndPenaltiesFn(
                fork,
                cloned_state.config,
                cloned_state.epoch_cache,
                cloned_state.state.castToFork(fork),
                &epoch_transition_cache,
                epoch_transition_cache.rewards,
                epoch_transition_cache.penalties,
            );

            self.actual_rewards = epoch_transition_cache.rewards;
            self.actual_penalties = epoch_transition_cache.penalties;
        }

        fn accumulateDeltas(
            expected_rewards: []u64,
            expected_penalties: []u64,
            deltas: *const DeltasType.Type,
        ) !void {
            const values = deltas.*;
            const rewards = values[0].items;
            const penalties = values[1].items;

            if (rewards.len != expected_rewards.len or penalties.len != expected_penalties.len) {
                return error.InvalidDeltaLength;
            }

            for (rewards, 0..) |value, i| {
                expected_rewards[i] += value;
            }
            for (penalties, 0..) |value, i| {
                expected_penalties[i] += value;
            }
        }
    };
}
