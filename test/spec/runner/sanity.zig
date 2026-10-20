const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const ssz = @import("consensus_types");
const ForkSeq = @import("config").ForkSeq;
const state_transition = @import("state_transition");
const TestCachedBeaconState = state_transition.test_utils.TestCachedBeaconState;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const AnySignedBeaconBlock = @import("fork_types").AnySignedBeaconBlock;
const test_case = @import("../test_case.zig");
const loadSszValue = test_case.loadSszSnappyValue;
const expectEqualBeaconStates = test_case.expectEqualBeaconStates;
const TestCaseUtils = test_case.TestCaseUtils;
const loadBlsSetting = test_case.loadBlsSetting;
const BlsSetting = test_case.BlsSetting;

/// https://github.com/ethereum/consensus-specs/blob/master/tests/formats/sanity/README.md
pub const Handler = enum {
    /// https://github.com/ethereum/consensus-specs/blob/master/tests/formats/sanity/blocks.md
    blocks,
    /// https://github.com/ethereum/consensus-specs/blob/master/tests/formats/sanity/slots.md
    slots,

    pub fn suiteName(self: Handler) []const u8 {
        return @tagName(self) ++ "/pyspec_tests";
    }
};

pub fn SlotsTestCase(comptime fork: ForkSeq) type {
    const tc_utils = TestCaseUtils(fork);

    return struct {
        pre: TestCachedBeaconState,
        post: *AnyBeaconState,
        slots: u64,

        const Self = @This();

        pub fn execute(allocator: std.mem.Allocator, pool: *Node.Pool, dir: std.Io.Dir) !void {
            var tc = try Self.init(allocator, pool, dir);
            defer {
                tc.deinit();
                state_transition.deinitReusedEpochTransitionCache();
            }

            try tc.runTest();
        }

        pub fn init(allocator: std.mem.Allocator, pool: *Node.Pool, dir: std.Io.Dir) !Self {
            var tc = Self{
                .pre = undefined,
                .post = undefined,
                .slots = 0,
            };

            // load pre state
            tc.pre = try tc_utils.loadPreState(allocator, pool, dir);
            errdefer tc.pre.deinit();

            // load post state
            tc.post = try tc_utils.loadPostState(allocator, pool, dir) orelse
                return error.PostStateNotFound;

            // load slots
            const slots_content = try dir.readFileAlloc(std.testing.io, "slots.yaml", allocator, .unlimited);
            defer allocator.free(slots_content);
            // Parse YAML for slots (simplified; assume single value)
            tc.slots = std.fmt.parseInt(u64, std.mem.trim(u8, slots_content, "... \n"), 10) catch 0;

            return tc;
        }

        pub fn deinit(self: *Self) void {
            self.pre.deinit();
            self.post.deinit();
            self.pre.allocator.destroy(self.post);
        }

        pub fn process(self: *Self) !void {
            try state_transition.state_transition.processSlots(
                self.pre.allocator,
                std.testing.io,
                self.pre.cached_state,
                try self.pre.cached_state.state.slot() + self.slots,
                null,
            );
        }

        pub fn runTest(self: *Self) !void {
            try self.process();
            try expectEqualBeaconStates(self.post, self.pre.cached_state.state);
        }
    };
}

pub fn BlocksTestCase(comptime fork: ForkSeq) type {
    const ForkTypes = @field(ssz, fork.name());
    const tc_utils = TestCaseUtils(fork);
    const SignedBeaconBlock = @field(ForkTypes, "SignedBeaconBlock");

    return struct {
        pre: TestCachedBeaconState,
        // a null post state means the test is expected to fail
        post: ?*AnyBeaconState,
        blocks: []SignedBeaconBlock.Type,
        bls_setting: BlsSetting,

        const Self = @This();

        pub fn execute(allocator: std.mem.Allocator, pool: *Node.Pool, dir: std.Io.Dir) !void {
            var tc = try Self.init(allocator, pool, dir);
            defer {
                tc.deinit();
                state_transition.deinitReusedEpochTransitionCache();
            }

            try tc.runTest();
        }

        pub fn init(allocator: std.mem.Allocator, pool: *Node.Pool, dir: std.Io.Dir) !Self {
            var tc = Self{
                .pre = undefined,
                .post = undefined,
                .blocks = undefined,
                .bls_setting = try loadBlsSetting(allocator, dir),
            };

            // load pre state
            tc.pre = try tc_utils.loadPreState(allocator, pool, dir);
            errdefer tc.pre.deinit();

            // load post state
            tc.post = try tc_utils.loadPostState(allocator, pool, dir);

            // Load meta.yaml for blocks_count
            const meta_content = try dir.readFileAlloc(std.testing.io, "meta.yaml", allocator, .unlimited);
            defer allocator.free(meta_content);
            // Parse YAML for blocks_count (simplified; assume "blocks_count: N")
            const blocks_count_str = std.mem.trim(u8, meta_content, " \n{}");
            const blocks_count = if (std.mem.find(u8, blocks_count_str, "blocks_count: ")) |start| blk: {
                const num_start = start + "blocks_count: ".len;
                const num_str = blocks_count_str[num_start..];
                const end = std.mem.find(u8, num_str, ",") orelse num_str.len;
                break :blk std.fmt.parseInt(usize, std.mem.trim(u8, num_str[0..end], " "), 10) catch 1;
            } else 1;

            // load blocks
            tc.blocks = try allocator.alloc(SignedBeaconBlock.Type, blocks_count);
            errdefer {
                for (tc.blocks) |*block| {
                    SignedBeaconBlock.deinit(allocator, block);
                }
                allocator.free(tc.blocks);
            }
            for (tc.blocks, 0..) |*block, i| {
                block.* = SignedBeaconBlock.default_value;
                const block_filename = try std.fmt.allocPrint(allocator, "blocks_{d}.ssz_snappy", .{i});
                defer allocator.free(block_filename);
                try loadSszValue(SignedBeaconBlock, allocator, dir, block_filename, block);
            }

            return tc;
        }

        pub fn deinit(self: *Self) void {
            for (self.blocks) |*block| {
                if (comptime @hasDecl(SignedBeaconBlock, "deinit")) {
                    SignedBeaconBlock.deinit(self.pre.allocator, block);
                }
            }
            self.pre.allocator.free(self.blocks);
            self.pre.deinit();
            if (self.post) |post| {
                post.deinit();
                self.pre.allocator.destroy(post);
            }
        }

        pub fn process(self: *Self) !*state_transition.CachedBeaconState {
            const verify = self.bls_setting.verify();
            var result: ?*state_transition.CachedBeaconState = null;
            for (self.blocks) |*block| {
                const signed_block = switch (fork) {
                    .phase0 => AnySignedBeaconBlock{ .phase0 = block },
                    .altair => AnySignedBeaconBlock{ .altair = block },
                    .bellatrix => AnySignedBeaconBlock{ .full_bellatrix = block },
                    .capella => AnySignedBeaconBlock{ .full_capella = block },
                    .deneb => AnySignedBeaconBlock{ .full_deneb = block },
                    .electra => AnySignedBeaconBlock{ .full_electra = block },
                    .fulu => AnySignedBeaconBlock{ .full_fulu = block },
                    .gloas => AnySignedBeaconBlock{ .full_gloas = block },
                };
                const input_cached_state = if (result) |res| res else self.pre.cached_state;
                {
                    // if error, clean pre_state of stateTransition() function
                    errdefer {
                        if (result) |res| {
                            res.deinit();
                            self.pre.allocator.destroy(res);
                        }
                    }
                    const new_result = try state_transition.state_transition.stateTransition(
                        self.pre.allocator,
                        std.testing.io,
                        input_cached_state,
                        signed_block,
                        .{
                            .verify_signatures = verify,
                            .verify_proposer = verify,
                        },
                        null,
                    );

                    if (result) |res| {
                        res.deinit();
                        self.pre.allocator.destroy(res);
                    }
                    result = new_result;
                }
            }

            return result orelse error.NoBlocks;
        }

        pub fn runTest(self: *Self) !void {
            if (self.post) |post| {
                const actual = try self.process();
                defer {
                    actual.deinit();
                    self.pre.allocator.destroy(actual);
                }
                try expectEqualBeaconStates(post, actual.state);
            } else {
                const unexpected = self.process() catch |err| {
                    return test_case.expectConsensusInvalid(err);
                };
                defer {
                    unexpected.deinit();
                    self.pre.allocator.destroy(unexpected);
                }
                return error.ExpectedError;
            }
        }
    };
}
