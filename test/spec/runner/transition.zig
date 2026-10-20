const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const ForkSeq = @import("config").ForkSeq;
const state_transition = @import("state_transition");
const TestCachedBeaconState = state_transition.test_utils.TestCachedBeaconState;
const AnySignedBeaconBlock = @import("fork_types").AnySignedBeaconBlock;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const test_case = @import("../test_case.zig");
const expectEqualBeaconStates = test_case.expectEqualBeaconStates;
const TestCaseUtils = test_case.TestCaseUtils;
const loadSignedBeaconBlock = test_case.loadSignedBeaconBlock;
const active_preset = @import("preset").active_preset;

pub fn Transition(comptime fork: ForkSeq) type {
    const tc_utils = TestCaseUtils(fork);

    return struct {
        pre: TestCachedBeaconState,
        post: ?*AnyBeaconState,
        blocks: []AnySignedBeaconBlock,

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

        pub fn init(allocator: std.mem.Allocator, pool: *Node.Pool, dir: std.Io.Dir) !Self {
            var tc = Self{
                .pre = undefined,
                .post = undefined,
                .blocks = undefined,
            };

            // Load meta.yaml for blocks_count
            const meta_content = try dir.readFileAlloc(std.testing.io, "meta.yaml", allocator, .unlimited);
            defer allocator.free(meta_content);
            const meta_content_one_line = std.mem.trim(u8, meta_content, " \n");
            // sample content of meta.yaml: {post_fork: electra, fork_epoch: 2, blocks_count: 96, fork_block: 62}
            // Parse YAML for fork_epoch (simplified; assume "fork_epoch: N")
            const fork_epoch = if (std.mem.find(u8, meta_content_one_line, "fork_epoch: ")) |start| blk: {
                const str = meta_content_one_line[start + "fork_epoch: ".len ..];
                if (std.mem.find(u8, str, ",")) |end| {
                    const num_str = str[0..end];
                    break :blk std.fmt.parseInt(usize, std.mem.trim(u8, num_str, " "), 10) catch 1;
                } else unreachable;
            } else unreachable;

            // block_count could be ended with "," or "}"
            // for example: {post_fork: altair, fork_epoch: 6, blocks_count: 2}
            const blocks_count = if (std.mem.find(u8, meta_content_one_line, "blocks_count: ")) |start| blk: {
                const str = meta_content_one_line[start + "blocks_count: ".len ..];
                const end = std.mem.find(u8, str, ",") orelse std.mem.find(u8, str, "}") orelse unreachable;
                const num_str = str[0..end];
                break :blk std.fmt.parseInt(usize, std.mem.trim(u8, num_str, " "), 10) catch 1;
            } else unreachable;

            // fork_block is optional
            const fork_block_idx = if (std.mem.find(u8, meta_content_one_line, "fork_block: ")) |start| blk: {
                const str = meta_content_one_line[start + "fork_block: ".len ..];
                if (std.mem.find(u8, str, "}")) |end| {
                    const num_str = str[0..end];
                    break :blk std.fmt.parseInt(u64, std.mem.trim(u8, num_str, " "), 10) catch 0;
                } else unreachable;
            } else null;

            // load blocks
            tc.blocks = try allocator.alloc(AnySignedBeaconBlock, blocks_count);
            errdefer {
                for (tc.blocks) |block| {
                    test_case.deinitSignedBeaconBlock(block, allocator);
                }
                allocator.free(tc.blocks);
            }
            for (0..blocks_count) |i| {
                // The fork_block is the index in the test data of the last block of the initial fork.
                const fork_block = if (fork_block_idx == null or i > fork_block_idx.?) fork else tc_utils.getForkPre();

                const block_filename = try std.fmt.allocPrint(allocator, "blocks_{d}.ssz_snappy", .{i});
                defer allocator.free(block_filename);
                tc.blocks[i] = try loadSignedBeaconBlock(allocator, fork_block, dir, block_filename);
            }

            // load pre state
            tc.pre = try tc_utils.loadPreStatePreFork(allocator, pool, dir, fork_epoch);
            errdefer tc.pre.deinit();

            // load post state
            tc.post = try tc_utils.loadPostState(allocator, pool, dir);

            return tc;
        }

        pub fn deinit(self: *Self) void {
            for (self.blocks) |block| {
                test_case.deinitSignedBeaconBlock(block, self.pre.allocator);
            }
            self.pre.allocator.free(self.blocks);
            self.pre.deinit();
            if (self.post) |post| {
                post.deinit();
                self.pre.allocator.destroy(post);
            }
        }

        pub fn process(self: *Self) !*state_transition.CachedBeaconState {
            var result: ?*state_transition.CachedBeaconState = null;
            for (self.blocks) |beacon_block| {
                const input_cached_state = if (result) |res| res else self.pre.cached_state;
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
                    beacon_block,
                    .{
                        .verify_state_root = true,
                        .verify_proposer = true,
                        .verify_signatures = true,
                    },
                    null,
                );

                if (result) |res| {
                    res.deinit();
                    self.pre.allocator.destroy(res);
                }
                result = new_result;
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
