//! Computes the Merkle witness that proves the current and next sync committee
//! roots are committed to by a beacon state root. Light-client servers serve
//! this witness so that clients can verify sync committee updates without
//! downloading the full beacon state.
//!
//! The witness is a sibling branch from the `sync_committees` subtree up to the
//! state root, ordered by descending gindex. The path through the BeaconState
//! tree differs across forks because the container layout changes: pre-electra
//! the sync committees live at gindices 54/55 (4 siblings), electra and fulu
//! at gindices 86/87 (5 siblings). Gloas uses separate single branches because
//! its committees at gindices 2945/2946 are not siblings.
//!
//! Tests are ported from lodestar:
//! packages/beacon-node/test/unit/chain/lightclient/proof.test.ts
const std = @import("std");

const ForkSeq = @import("config").ForkSeq;
const Node = @import("persistent_merkle_tree").Node;
const createSingleProofInto = @import("persistent_merkle_tree").proof.createSingleProofInto;
const constants = @import("constants");

const current_gindex_gloas = constants.CURRENT_SYNC_COMMITTEE_GINDEX_GLOAS;
const next_gindex_gloas = constants.NEXT_SYNC_COMMITTEE_GINDEX_GLOAS;

/// Witness data needed to prove the current and next sync committee roots
/// against the beacon state root. Used by the light-client server.
///
/// Witness branch is sorted by descending gindex.
/// Pre-electra: 4 shared entries. Electra/fulu: 5 shared entries.
/// Gloas: no shared witness; each committee has its own leaf-to-root branch.
pub const SyncCommitteeWitness = struct {
    witness_buf: [5][32]u8,
    witness_len: u8 = 0,
    current_sync_committee_root: [32]u8,
    next_sync_committee_root: [32]u8,
    gloas_branches: ?struct {
        current: [std.math.log2_int(u64, current_gindex_gloas)][32]u8,
        next: [std.math.log2_int(u64, next_gindex_gloas)][32]u8,
    } = null,

    pub fn witness(self: *const SyncCommitteeWitness) []const [32]u8 {
        return self.witness_buf[0..self.witness_len];
    }
};

/// Compute the sync-committee witness for the beacon state rooted at `root_node`.
///
/// The walk path depends on which fork the state was produced under because the BeaconState
/// container layout changes across forks — sync committee fields move to different gindices.
pub fn getSyncCommitteesWitness(
    fork: ForkSeq,
    root_node: Node.Id,
    pool: *Node.Pool,
    out: *SyncCommitteeWitness,
) !void {
    std.debug.assert(fork.gte(.altair));
    out.gloas_branches = null;
    const n1 = root_node;

    var current: Node.Id = undefined;
    var next: Node.Id = undefined;
    if (fork.gte(.gloas)) {
        out.gloas_branches = .{ .current = undefined, .next = undefined };
        out.current_sync_committee_root = try createSingleProofInto(pool.allocator, pool, root_node, @enumFromInt(current_gindex_gloas), &out.gloas_branches.?.current);
        out.next_sync_committee_root = try createSingleProofInto(pool.allocator, pool, root_node, @enumFromInt(next_gindex_gloas), &out.gloas_branches.?.next);
        out.witness_len = 0;
        return;
    } else if (fork.gte(.electra)) {
        const n2 = try Node.Id.getLeft(n1, pool);
        const n5 = try Node.Id.getRight(n2, pool);
        const n10 = try Node.Id.getLeft(n5, pool);
        const n21 = try Node.Id.getRight(n10, pool);
        const n43 = try Node.Id.getRight(n21, pool);

        current = try Node.Id.getLeft(n43, pool); // n86
        next = try Node.Id.getRight(n43, pool); // n87

        // Siblings on the path to the sync-committee subtree, descending gindex order.
        const w0 = try Node.Id.getLeft(n21, pool); // gindex 42
        const w1 = try Node.Id.getLeft(n10, pool); // gindex 20
        const w2 = try Node.Id.getRight(n5, pool); // gindex 11
        const w3 = try Node.Id.getLeft(n2, pool); // gindex 4
        const w4 = try Node.Id.getRight(n1, pool); // gindex 3

        out.witness_buf[0..5].* = .{
            w0.getRoot(pool).*,
            w1.getRoot(pool).*,
            w2.getRoot(pool).*,
            w3.getRoot(pool).*,
            w4.getRoot(pool).*,
        };
        out.witness_len = 5;
    }
    // Pre-electra layout (altair → deneb): sync committees at gindices 54, 55.
    else {
        const n3 = try Node.Id.getRight(n1, pool); // [1]0110
        const n6 = try Node.Id.getLeft(n3, pool); // 1[0]110
        const n13 = try Node.Id.getRight(n6, pool); // 10[1]10
        const n27 = try Node.Id.getRight(n13, pool); // 101[1]0

        current = try Node.Id.getLeft(n27, pool); // n54 — 1011[0]
        next = try Node.Id.getRight(n27, pool); // n55 — 1011[1]

        const w0 = try Node.Id.getLeft(n13, pool); // gindex 26
        const w1 = try Node.Id.getLeft(n6, pool); // gindex 12
        const w2 = try Node.Id.getRight(n3, pool); // gindex 7
        const w3 = try Node.Id.getLeft(n1, pool); // gindex 2

        out.witness_buf[0..5].* = .{
            w0.getRoot(pool).*,
            w1.getRoot(pool).*,
            w2.getRoot(pool).*,
            w3.getRoot(pool).*,
            std.mem.zeroes([32]u8),
        };
        out.witness_len = 4;
    }

    out.current_sync_committee_root = current.getRoot(pool).*;
    out.next_sync_committee_root = next.getRoot(pool).*;
}

test {
    _ = @import("sync_committees_witness_test.zig");
}
