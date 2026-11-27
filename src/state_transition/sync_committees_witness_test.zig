//! Tests for `sync_committees_witness.zig`.
//! Computes the Merkle witness that proves the current and next sync committee
//! roots are committed to by a beacon state root. Light-client servers serve
//! this witness so that clients can verify sync committee updates without
//! downloading the full beacon state.
//!
//! The witness is a sibling branch from the `sync_committees` subtree up to the
//! state root, ordered by descending gindex. The path through the BeaconState
//! tree differs across forks because the container layout changes: pre-electra
//! the sync committees live at gindices 54/55 (4 siblings), electra/fulu
//! at gindices 86/87 (5 siblings), and Gloas at 2945/2946 (separate branches).
//!
//! Tests are ported from lodestar:
//! packages/beacon-node/test/unit/chain/lightclient/proof.test.ts
const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const Node = @import("persistent_merkle_tree").Node;
const ct = @import("consensus_types");
const preset = @import("preset").preset;
const hashOne = @import("hashing").hashOne;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const verifyMerkleBranch = @import("./utils/verify_merkle_branch.zig").verifyMerkleBranch;
const SyncCommitteeWitness = @import("sync_committees_witness.zig").SyncCommitteeWitness;
const getSyncCommitteesWitness = @import("sync_committees_witness.zig").getSyncCommitteesWitness;

const NUM_WITNESS: u8 = 4;

const NUM_WITNESS_ELECTRA: u8 = 5;

fn fillSyncCommittee(byte: u8) ct.altair.SyncCommittee.Type {
    return .{
        .pubkeys = [_][48]u8{[_]u8{byte} ** 48} ** preset.SYNC_COMMITTEE_SIZE,
        .aggregate_pubkey = [_]u8{byte} ** 48,
    };
}

/// Convert a gindex to (depth, index-at-depth)
fn fromGindex(gindex: usize) struct { depth: usize, index: usize } {
    const depth = std.math.log2_int(usize, gindex);
    const first_index = @as(usize, 1) << @intCast(depth);
    return .{ .depth = depth, .index = gindex - first_index };
}

/// Pack a variable-length witness branch into the fixed [33]Root proof buffer
/// that verifyMerkleBranch expects. Only the first `depth` slots are read by
/// verifyMerkleBranch.
fn packProof(branch: []const [32]u8) [33][32]u8 {
    var proof: [33][32]u8 = .{[_]u8{0} ** 32} ** 33;
    for (branch, 0..) |w, i| proof[i] = w;
    return proof;
}

/// Sets up a sync-committee proof. Only used for tests.
const ProofFixture = struct {
    pool: Node.Pool,
    state: AnyBeaconState,
    state_root: [32]u8,
    root_node: Node.Id,
    current_sync_committee: ct.altair.SyncCommittee.Type,
    next_sync_committee: ct.altair.SyncCommittee.Type,

    fn init(self: *ProofFixture, fork: ForkSeq) !void {
        const allocator = std.testing.allocator;
        self.pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
        errdefer self.pool.deinit();

        self.state = switch (fork) {
            .altair => try AnyBeaconState.fromValue(allocator, &self.pool, .altair, &ct.altair.BeaconState.default_value),
            .electra => try AnyBeaconState.fromValue(allocator, &self.pool, .electra, &ct.electra.BeaconState.default_value),
            .gloas => try AnyBeaconState.fromValue(allocator, &self.pool, .gloas, &ct.gloas.BeaconState.default_value),
            else => return error.UnsupportedFork,
        };
        errdefer self.state.deinit();

        self.current_sync_committee = fillSyncCommittee(0xbb);
        self.next_sync_committee = fillSyncCommittee(0xcc);
        try self.state.setCurrentSyncCommittee(&self.current_sync_committee);
        try self.state.setNextSyncCommittee(&self.next_sync_committee);

        try self.state.commit();
        self.state_root = (try self.state.hashTreeRoot()).*;
        self.root_node = switch (self.state) {
            inline else => |view| view.root,
        };
    }

    fn deinit(self: *ProofFixture) void {
        self.state.deinit();
        self.pool.deinit();
    }
};

test "getSyncCommitteesWitness: SyncCommittees proof" {
    const TestCase = struct {
        fork_seq: ForkSeq,
        num_witness: u8,
        sync_committees_gindex: usize,
    };

    const test_cases: [2]TestCase = .{
        .{
            .fork_seq = .altair,
            .num_witness = NUM_WITNESS,
            .sync_committees_gindex = 27,
        },
        .{
            .fork_seq = .electra,
            .num_witness = NUM_WITNESS_ELECTRA,
            .sync_committees_gindex = 43,
        },
    };

    for (test_cases) |tc| {
        var fixture: ProofFixture = undefined;
        try fixture.init(tc.fork_seq);
        defer fixture.deinit();

        var witness_data: SyncCommitteeWitness = undefined;
        try getSyncCommitteesWitness(tc.fork_seq, fixture.root_node, &fixture.pool, &witness_data);

        var sync_committees_leaf: [32]u8 = undefined;
        hashOne(&sync_committees_leaf, &witness_data.current_sync_committee_root, &witness_data.next_sync_committee_root);

        try std.testing.expectEqual(@as(u8, tc.num_witness), witness_data.witness_len);
        try std.testing.expectEqual(null, witness_data.gloas_branches);

        const pos = fromGindex(tc.sync_committees_gindex);
        const proof = packProof(witness_data.witness());
        try std.testing.expect(verifyMerkleBranch(sync_committees_leaf, &proof, pos.depth, pos.index, fixture.state_root));
    }
}

test "getSyncCommitteesWitness: currentSyncCommittee proof" {
    const TestCase = struct {
        fork_seq: ForkSeq,
        num_witness: u8,
        current_sync_committee_gindex: usize,
    };

    const test_cases: [2]TestCase = .{
        .{
            .fork_seq = .altair,
            .num_witness = NUM_WITNESS,
            .current_sync_committee_gindex = 54,
        },
        .{
            .fork_seq = .electra,
            .num_witness = NUM_WITNESS_ELECTRA,
            .current_sync_committee_gindex = 86,
        },
    };

    inline for (test_cases) |tc| {
        var fixture: ProofFixture = undefined;
        try fixture.init(tc.fork_seq);
        defer fixture.deinit();

        var witness_data: SyncCommitteeWitness = undefined;
        try getSyncCommitteesWitness(tc.fork_seq, fixture.root_node, &fixture.pool, &witness_data);

        // currentSyncCommitteeBranch = [nextSyncCommitteeRoot, ...witness]
        var branch_buf: [tc.num_witness + 1][32]u8 = undefined;
        branch_buf[0] = witness_data.next_sync_committee_root;
        for (witness_data.witness(), 0..) |w, i| branch_buf[1 + i] = w;

        try std.testing.expectEqual(@as(u8, tc.num_witness), witness_data.witness_len);

        var current_leaf: [32]u8 = undefined;
        try ct.altair.SyncCommittee.hashTreeRoot(&fixture.current_sync_committee, &current_leaf);

        const pos = fromGindex(tc.current_sync_committee_gindex);
        const proof = packProof(&branch_buf);
        try std.testing.expect(verifyMerkleBranch(current_leaf, &proof, pos.depth, pos.index, fixture.state_root));
    }
}

test "getSyncCommitteesWitness: nextSyncCommittee proof" {
    const TestCase = struct {
        fork_seq: ForkSeq,
        num_witness: u8,
        next_sync_committee_gindex: usize,
    };

    const test_cases: [2]TestCase = .{
        .{
            .fork_seq = .altair,
            .num_witness = NUM_WITNESS,
            .next_sync_committee_gindex = 55,
        },
        .{
            .fork_seq = .electra,
            .num_witness = NUM_WITNESS_ELECTRA,
            .next_sync_committee_gindex = 87,
        },
    };

    inline for (test_cases) |tc| {
        var fixture: ProofFixture = undefined;
        try fixture.init(tc.fork_seq);
        defer fixture.deinit();

        var witness_data: SyncCommitteeWitness = undefined;
        try getSyncCommitteesWitness(tc.fork_seq, fixture.root_node, &fixture.pool, &witness_data);

        // nextSyncCommitteeBranch = [currentSyncCommitteeRoot, ...witness]
        var branch_buf: [tc.num_witness + 1][32]u8 = undefined;
        branch_buf[0] = witness_data.current_sync_committee_root;
        for (witness_data.witness(), 0..) |w, i| branch_buf[1 + i] = w;

        try std.testing.expectEqual(@as(u8, tc.num_witness), witness_data.witness_len);

        var next_leaf: [32]u8 = undefined;
        try ct.altair.SyncCommittee.hashTreeRoot(&fixture.next_sync_committee, &next_leaf);

        const pos = fromGindex(tc.next_sync_committee_gindex);
        const proof = packProof(&branch_buf);
        try std.testing.expect(verifyMerkleBranch(next_leaf, &proof, pos.depth, pos.index, fixture.state_root));
    }
}

test "getSyncCommitteesWitness: Gloas separate committee branches" {
    var fixture: ProofFixture = undefined;
    try fixture.init(.gloas);
    defer fixture.deinit();
    var witness_data: SyncCommitteeWitness = undefined;
    try getSyncCommitteesWitness(.gloas, fixture.root_node, &fixture.pool, &witness_data);
    try std.testing.expectEqual(@as(u8, 0), witness_data.witness_len);
    const branches = witness_data.gloas_branches orelse return error.MissingCommitteeBranches;

    // Independently hash the value rather than using the proof walk's tree nodes
    // as the only root oracle. Keep the large mainnet value off the test stack.
    const value = try std.testing.allocator.create(ct.gloas.BeaconState.Type);
    defer std.testing.allocator.destroy(value);
    value.* = ct.gloas.BeaconState.default_value;
    value.current_sync_committee = fixture.current_sync_committee;
    value.next_sync_committee = fixture.next_sync_committee;
    var expected_root: [32]u8 = undefined;
    try ct.gloas.BeaconState.hashTreeRoot(std.testing.allocator, value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &fixture.state_root);
    var current_root: [32]u8 = undefined;
    var next_root: [32]u8 = undefined;
    try ct.altair.SyncCommittee.hashTreeRoot(&fixture.current_sync_committee, &current_root);
    try ct.altair.SyncCommittee.hashTreeRoot(&fixture.next_sync_committee, &next_root);
    try std.testing.expectEqualSlices(u8, &current_root, &witness_data.current_sync_committee_root);
    try std.testing.expectEqualSlices(u8, &next_root, &witness_data.next_sync_committee_root);

    inline for (.{
        .{ current_root, branches.current, 2945 },
        .{ next_root, branches.next, 2946 },
    }) |tc| {
        const pos = fromGindex(tc[2]);
        try std.testing.expectEqual(@as(usize, 11), tc[1].len);
        var proof = packProof(&tc[1]);
        try std.testing.expect(verifyMerkleBranch(tc[0], &proof, pos.depth, pos.index, expected_root));
        // Each witness position is necessary; a modified sibling must fail.
        for (0..pos.depth) |i| {
            proof[i][0] ^= 1;
            try std.testing.expect(!verifyMerkleBranch(tc[0], &proof, pos.depth, pos.index, expected_root));
            proof[i][0] ^= 1;
        }
    }

    var old_fixture: ProofFixture = undefined;
    try old_fixture.init(.electra);
    defer old_fixture.deinit();
    // Reusing the output must not leave Gloas branch fields on a legacy result.
    try getSyncCommitteesWitness(.electra, old_fixture.root_node, &old_fixture.pool, &witness_data);
    try std.testing.expectEqual(null, witness_data.gloas_branches);
    try std.testing.expectEqual(@as(u8, 5), witness_data.witness_len);
}
