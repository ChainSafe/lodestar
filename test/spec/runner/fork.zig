const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const ForkSeq = @import("config").ForkSeq;
const state_transition = @import("state_transition");
const upgradeStateToAltair = state_transition.upgradeStateToAltair;
const upgradeStateToBellatrix = state_transition.upgradeStateToBellatrix;
const upgradeStateToCapella = state_transition.upgradeStateToCapella;
const upgradeStateToDeneb = state_transition.upgradeStateToDeneb;
const upgradeStateToElectra = state_transition.upgradeStateToElectra;
const upgradeStateToFulu = state_transition.upgradeStateToFulu;
const upgradeStateToGloas = state_transition.upgradeStateToGloas;
const TestCachedBeaconState = state_transition.test_utils.TestCachedBeaconState;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const test_case = @import("../test_case.zig");
const TestCaseUtils = test_case.TestCaseUtils;
const expectEqualBeaconStates = test_case.expectEqualBeaconStates;
const active_preset = @import("preset").active_preset;

pub const Handler = enum {
    fork,

    pub fn suiteName(self: Handler) []const u8 {
        return @tagName(self) ++ "/pyspec_tests";
    }
};

const Allocator = std.mem.Allocator;

pub fn TestCase(comptime target_fork: ForkSeq) type {
    comptime {
        switch (target_fork) {
            .altair, .bellatrix, .capella, .deneb, .electra, .fulu, .gloas => {},
            else => @compileError("fork tests are not defined for " ++ @tagName(target_fork)),
        }
    }

    const pre_fork = comptime previousFork(target_fork);
    const pre_tc_utils = TestCaseUtils(pre_fork);
    const post_tc_utils = TestCaseUtils(target_fork);

    return struct {
        pre: TestCachedBeaconState,
        post: ?*AnyBeaconState,

        const Self = @This();

        pub fn execute(allocator: Allocator, dir: std.Io.Dir) !void {
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

        fn init(allocator: Allocator, pool: *Node.Pool, dir: std.Io.Dir) !Self {
            const meta_fork = try loadTargetFork(allocator, dir);
            if (meta_fork != target_fork) return error.InvalidMetaFile;

            var pre_state = try pre_tc_utils.loadPreState(allocator, pool, dir);
            errdefer pre_state.deinit();

            const post_state = try post_tc_utils.loadPostState(allocator, pool, dir);

            return .{
                .pre = pre_state,
                .post = post_state,
            };
        }

        fn deinit(self: *Self) void {
            self.pre.deinit();
            if (self.post) |post| {
                post.deinit();
                self.pre.allocator.destroy(post);
            }
        }

        fn runTest(self: *Self) !void {
            if (self.post) |expected| {
                try self.upgrade();
                try expectEqualBeaconStates(expected, self.pre.cached_state.state);
            } else {
                self.upgrade() catch |err| {
                    return test_case.expectConsensusInvalid(err);
                };
                return error.ExpectedError;
            }
        }

        fn upgrade(self: *Self) !void {
            const cached_state = self.pre.cached_state;
            const config = cached_state.config;
            const epoch_cache = cached_state.epoch_cache;
            switch (target_fork) {
                .altair => {
                    const upgraded = try upgradeStateToAltair(
                        self.pre.allocator,
                        config,
                        epoch_cache,
                        try cached_state.state.tryCastToFork(.phase0),
                    );
                    cached_state.state.* = .{ .altair = upgraded.inner };
                },
                .bellatrix => {
                    const upgraded = try upgradeStateToBellatrix(
                        config,
                        epoch_cache,
                        try cached_state.state.tryCastToFork(.altair),
                    );
                    cached_state.state.* = .{ .bellatrix = upgraded.inner };
                },
                .capella => {
                    const upgraded = try upgradeStateToCapella(
                        self.pre.allocator,
                        config,
                        epoch_cache,
                        try cached_state.state.tryCastToFork(.bellatrix),
                    );
                    cached_state.state.* = .{ .capella = upgraded.inner };
                },
                .deneb => {
                    const upgraded = try upgradeStateToDeneb(
                        self.pre.allocator,
                        config,
                        epoch_cache,
                        try cached_state.state.tryCastToFork(.capella),
                    );
                    cached_state.state.* = .{ .deneb = upgraded.inner };
                },
                .electra => {
                    const upgraded = try upgradeStateToElectra(
                        self.pre.allocator,
                        config,
                        epoch_cache,
                        try cached_state.state.tryCastToFork(.deneb),
                    );
                    cached_state.state.* = .{ .electra = upgraded.inner };
                },
                .fulu => {
                    const upgraded = try upgradeStateToFulu(
                        self.pre.allocator,
                        config,
                        epoch_cache,
                        try cached_state.state.tryCastToFork(.electra),
                    );
                    cached_state.state.* = .{ .fulu = upgraded.inner };
                },
                .gloas => {
                    const upgraded = try upgradeStateToGloas(
                        self.pre.allocator,
                        std.testing.io,
                        config,
                        epoch_cache,
                        try cached_state.state.tryCastToFork(.fulu),
                    );
                    cached_state.state.* = .{ .gloas = upgraded.inner };
                },
                else => unreachable,
            }
        }
    };
}

fn loadTargetFork(allocator: Allocator, dir: std.Io.Dir) !ForkSeq {
    const contents = try dir.readFileAlloc(std.testing.io, "meta.yaml", allocator, .unlimited);
    defer allocator.free(contents);

    const key = "fork: ";
    if (std.mem.find(u8, contents, key)) |start| {
        const after_key = contents[start + key.len ..];
        const end = std.mem.find(u8, after_key, "}") orelse return error.InvalidMetaFile;
        const fork_slice = after_key[0..end];
        if (fork_slice.len == 0) return error.InvalidMetaFile;
        return ForkSeq.fromName(fork_slice);
    }

    return error.InvalidMetaFile;
}

fn previousFork(target: ForkSeq) ForkSeq {
    return switch (target) {
        .altair => .phase0,
        .bellatrix => .altair,
        .capella => .bellatrix,
        .deneb => .capella,
        .electra => .deneb,
        .fulu => .electra,
        .gloas => .fulu,
        else => @compileError("Unsupported fork transition for " ++ @tagName(target)),
    };
}
