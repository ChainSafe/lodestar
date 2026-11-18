//! FG store Sigma without the per-block chain state, fgsa-spec.pdf Sections 1.3 and 2, Figure 3.
//!
//! The state transition owns sigma[B] (ChainState in simulation, the beacon state in a client).
//! This store keeps the tree, each block's BlockSummary, and the caches F, J, h_j, h_max derived
//! from them. The attestation pool and FG_ATTEST belong to the validator (AttestationPool, Node).
//!
//! Allocate in place on the heap and keep its address stable while frames borrow stored payloads.
//!
//! Node owns time, proposer selection, signatures, digest verification, AC payload validation, and
//! runs the state transition only for blocks canAccept admits. FG checks tree-relative validity,
//! not wire validation or AC semantics.
//!
//! Storage bounds end an incomplete run; they do not authorize eviction or extra wire restrictions.
const std = @import("std");
const assert = std.debug.assert;
const BoundedArray = @import("bounded_array").BoundedArray;
const limits = @import("../limits.zig");
const types = @import("../types.zig");
const fg = @import("finality_types.zig");
const Frame = @import("FinalityFrame.zig");

const FinalityGadget = @This();
const Root = fg.Root;
pub const Block = fg.Block;
pub const Attestation = fg.Attestation;
pub const AttestationList = BoundedArray(Attestation, limits.max_attestations_per_block);
pub const Error = Frame.Error || error{
    BlockCapacity,
    PayloadCapacity,
    AttestationCapacity,
    UnknownBlock,
};

pub const Config = struct {
    /// Root of B_gen, the supplied genesis block from Section 1.3 (p. 3).
    B_gen: Root,
};

/// Genesis identity, not an additional component of Sigma.
config: Config,
/// Sigma.T: full immutable accepted blocks, in parent order, including branches outside F.
T: BoundedArray(StoredBlock, limits.max_blocks),
/// The store's view of Sigma.sigma[B]: the summary at the corresponding index in T.
summaries: [limits.max_blocks]fg.BlockSummary,
/// Sigma.F: accepted finalized block. It moves only to descendants.
F: fg.BlockRef,
/// Sigma.J and Sigma.h_j: lex-greatest accepted justification extending F.
J: fg.BlockRef,
h_j: fg.Height,
/// Sigma.h_max: greatest accepted chain-state height, initially one (Section 1.3).
h_max: fg.Height,

const OwnedPayload = struct {
    votes: BoundedArray(Frame.SignedVote, limits.max_vote_set),
    support_votes: BoundedArray(types.GoldfishVote, limits.max_vote_set),
};
pub const StoredBlock = struct {
    root: Root,
    slot: types.Slot,
    parent: Root,
    proposer: types.ValidatorIndex,
    ac_payload: OwnedPayload,
    attestations: AttestationList,

    pub fn init(self: *StoredBlock, B: *const Block) void {
        self.root = B.root;
        self.slot = B.slot;
        self.parent = B.parent;
        self.proposer = B.proposer;
        self.ac_payload = .{ .votes = .{}, .support_votes = .{} };
        self.attestations = .{};
        for (B.ac_payload.votes) |vote| self.ac_payload.votes.push(vote);
        for (B.ac_payload.support_votes) |vote| self.ac_payload.support_votes.push(vote);
        for (B.attestations) |a| self.attestations.push(a);
    }

    pub fn view(self: *const StoredBlock) Block {
        return .{
            .root = self.root,
            .slot = self.slot,
            .parent = self.parent,
            .proposer = self.proposer,
            .ac_payload = .{
                .votes = self.ac_payload.votes.constSlice(),
                .support_votes = self.ac_payload.support_votes.constSlice(),
            },
            .attestations = self.attestations.constSlice(),
        };
    }

    fn frameBlock(self: *const StoredBlock) Frame.Block {
        return .{
            .root = self.root,
            .slot = self.slot,
            .parent = self.parent,
            .payload = .{
                .votes = self.ac_payload.votes.constSlice(),
                .support_votes = self.ac_payload.support_votes.constSlice(),
            },
        };
    }
};
/// Caller-owned projection headers. Frame payloads still borrow this FG's stored block contents.
pub const FrameBuffer = struct { tree: [limits.max_blocks]Frame.Block };

/// Section 1.3 (p. 3): genesis-only tree, F = J = B_gen, h_j = 0, h_max = 1.
/// The genesis summary matches ChainState.init: height one, no justification or finality.
pub fn init(self: *FinalityGadget, config: *const Config) void {
    self.config = config.*;
    self.T = .{};
    const B_gen: Block = .{
        .root = config.B_gen,
        .parent = config.B_gen,
        .slot = 0,
        .proposer = 0,
    };
    self.T.buffer[0].init(&B_gen);
    self.T.count = 1;
    const genesis = B_gen.ref();
    self.summaries[0] = .{ .h = 1, .T_h = genesis, .h_j = 0, .J = genesis, .h_F = 0, .F = genesis };
    self.F = genesis;
    self.J = genesis;
    self.h_j = 0;
    self.h_max = 1;
}

/// Figure 3, lines 1-3: unknown root, known parent, and parent inside the finalized subtree.
/// Node runs the state transition only for blocks this admits.
pub fn canAccept(self: *const FinalityGadget, B: *const Block) bool {
    if (self.find(&B.root) != null) return false;
    const parent_index = self.find(&B.parent) orelse return false;
    return self.isAncestor(self.find(&self.F.root).?, parent_index);
}

/// Figure 3, lines 4-9, with the state transition already run; summary is sigma[B]'s projection.
/// Node must first reject future slots and verify signatures, content root, and AC payload.
/// A false result or error leaves Sigma unchanged. Successful acceptance owns all lists.
pub fn onBlock(self: *FinalityGadget, B: *const Block, summary: *const fg.BlockSummary) Error!bool {
    if (!self.canAccept(B)) return false;
    assert(summary.valid());
    try checkBlockBounds(B);
    if (self.T.full()) return error.BlockCapacity;
    const index = self.T.count;
    self.T.buffer[index].init(B);
    self.summaries[index] = summary.*;
    self.T.count += 1;
    self.updateFinality(&self.summaries[index]);
    assert(self.T.count == index + 1);
    return true;
}

/// Figure 3, lines 12-15: the confirmed block's height entry and the head's finality view.
/// Only chain states selected by AC supply these inputs to Lambda.
pub fn attestationInput(
    self: *const FinalityGadget,
    fg_confirmed: *const Root,
    head: *const Root,
) Error!fg.AttestationInput {
    const confirmed_index = self.find(fg_confirmed) orelse return error.UnknownBlock;
    const head_index = self.find(head) orelse return error.UnknownBlock;
    const confirmed = &self.summaries[confirmed_index];
    const head_summary = &self.summaries[head_index];
    return .{
        .h_c = confirmed.h,
        .T_c = confirmed.T_h.root,
        .h_j = head_summary.h_j,
        .J = head_summary.J.root,
        .h_F = head_summary.h_F,
    };
}

/// Figure 3, lines 16-21. Called only after publishing a fully accepted block and its summary.
fn updateFinality(self: *FinalityGadget, summary: *const fg.BlockSummary) void {
    self.h_max = @max(self.h_max, summary.h);
    if (self.isAncestor(self.find(&self.F.root).?, self.find(&summary.J.root).?)) {
        if (summary.h_j > self.h_j or (summary.h_j == self.h_j and
            types.rootOrder(&summary.J.root, &self.J.root) == .gt))
        {
            self.J = summary.J;
            self.h_j = summary.h_j;
        }
    }
    const F = self.find(&self.F.root).?;
    const candidate = self.find(&summary.F.root).?;
    if (F != candidate and self.isAncestor(F, candidate) and
        self.isAncestor(candidate, self.find(&self.J.root).?) and
        self.hasViableDescendant(&summary.F.root)) self.F = summary.F;
}

/// Figure 3, lines 22-26: inspect all F-descendant blocks at h_max, not a voter's frozen tree.
pub fn fgContest(self: *const FinalityGadget) bool {
    if (self.h_max != self.h_j + 1) return false;
    const F = self.find(&self.F.root).?;
    const J = self.find(&self.J.root).?;
    for (self.T.constSlice(), 0..) |_, index| {
        if (self.summaries[index].h == self.h_max and self.isAncestor(F, @intCast(index)) and
            !self.isAncestor(J, @intCast(index))) return true;
    }
    return false;
}

/// Figure 3, lines 27-30: contest raises the floor from h_max - 1 to h_max.
pub fn headHeightFloor(self: *const FinalityGadget) fg.Height {
    assert(self.h_max >= 1);
    return if (self.fgContest()) self.h_max else self.h_max - 1;
}

/// Figure 3, lines 31-34: use J only at an uncontested frontier, otherwise F.
pub fn getFCRoot(self: *const FinalityGadget) fg.BlockRef {
    if (self.h_max == self.h_j + 1 and !self.fgContest()) return self.J;
    return self.F;
}

/// Figure 3, lines 35-36: viability compares chain-state height, not block slot.
pub fn isViable(self: *const FinalityGadget, B: *const Root) bool {
    const index = self.find(B) orelse return false;
    return self.summaries[index].h >= self.headHeightFloor();
}

/// Figure 3, lines 37-38: a viable descendant may be B itself.
pub fn hasViableDescendant(self: *const FinalityGadget, B: *const Root) bool {
    const index = self.find(B) orelse return false;
    const floor = self.headHeightFloor();
    for (self.T.constSlice(), 0..) |_, descendant| {
        if (self.summaries[descendant].h >= floor and self.isAncestor(index, @intCast(descendant))) {
            return true;
        }
    }
    return false;
}

/// Figure 3, lines 39-43. Rebuild after FG mutation.
/// Headers borrow buffer; payloads borrow Sigma.T.
pub fn toAC(self: *const FinalityGadget, buffer: *FrameBuffer) Frame.Error!Frame {
    const F = self.find(&self.F.root).?;
    const fc_root = self.getFCRoot();
    const fc_index = self.find(&fc_root.root).?;
    const floor = self.headHeightFloor();
    var viable_heads: Frame.Mask = @splat(false);
    var count: u32 = 0;
    for (self.T.constSlice(), 0..) |*B, index| {
        if (!self.isAncestor(F, @intCast(index))) continue;
        buffer.tree[count] = B.frameBlock();
        viable_heads[count] = self.isAncestor(fc_index, @intCast(index)) and
            self.summaries[index].h >= floor;
        count += 1;
    }
    return Frame.init(buffer.tree[0..count], &fc_root.root, &viable_heads);
}

/// Look up the storage position of a root in Sigma.T; no block contents are inferred from a root.
pub fn find(self: *const FinalityGadget, root: *const Root) ?u32 {
    assert(self.T.count > 0);
    assert(self.T.count <= limits.max_blocks);
    for (self.T.constSlice(), 0..) |*B, index| {
        if (rootsEqual(&B.root, root)) return @intCast(index);
    }
    return null;
}

fn parent(self: *const FinalityGadget, index: u32) u32 {
    assert(index > 0);
    assert(index < self.T.count);
    const result = self.find(&self.T.buffer[index].parent).?;
    assert(result < index);
    return result;
}

/// Section 1.2 (p. 2): reflexive ancestry in the full accepted tree, including blocks outside F.
pub fn isAncestor(self: *const FinalityGadget, ancestor: u32, descendant: u32) bool {
    assert(ancestor < self.T.count);
    assert(descendant < self.T.count);
    var cursor = descendant;
    for (0..limits.max_blocks) |_| {
        if (cursor == ancestor) return true;
        if (cursor == 0) return false;
        cursor = self.parent(cursor);
    }
    unreachable;
}

/// Figure 3, line 45: whether a is carried by H or any block on H's parent chain.
pub fn includedOnChain(self: *const FinalityGadget, H: u32, a: *const Attestation) bool {
    assert(H < self.T.count);
    var cursor = H;
    for (0..limits.max_blocks) |_| {
        for (self.T.buffer[cursor].attestations.constSlice()) |*included| {
            if (included.eql(a)) return true;
        }
        if (cursor == 0) return false;
        cursor = self.parent(cursor);
    }
    unreachable;
}

fn checkBlockBounds(B: *const Block) Error!void {
    if (B.attestations.len > limits.max_attestations_per_block) return error.AttestationCapacity;
    if (B.ac_payload.votes.len > limits.max_vote_set or
        B.ac_payload.support_votes.len > limits.max_vote_set) return error.PayloadCapacity;
}

fn rootsEqual(a: *const Root, b: *const Root) bool {
    return std.mem.eql(u8, a, b);
}

test {
    _ = @import("finality_gadget_test.zig");
}
