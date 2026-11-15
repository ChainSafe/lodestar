const std = @import("std");
const Allocator = std.mem.Allocator;

const GindexUint = @import("hashing").GindexUint;
const max_depth = @import("hashing").max_depth;
const Node = @import("Node.zig");
const Gindex = @import("gindex.zig").Gindex;

const root_gindex_value: GindexUint = 1;

pub const Error = error{
    /// Allocator or pool could not reserve enough memory.
    OutOfMemory,
    /// Provided generalized index is not part of the binary tree (must be >= 1).
    InvalidGindex,
    /// Witness list length does not match the gindex path length.
    InvalidWitnessLength,
    /// A proof branch path exceeds the supported tree depth.
    InvalidProofDepth,
};

pub const ProofType = enum {
    single,
    compactMulti,

    pub fn toString(self: ProofType) []const u8 {
        return switch (self) {
            .single => "single",
            .compactMulti => "compactMulti",
        };
    }
};

/// Input for creating a single proof
pub const SingleProofInput = struct {
    gindex: Gindex,
};

/// Input for creating a compact multi proof
pub const CompactMultiProofInput = struct {
    descriptor: []const u8,
};

pub const ProofInput = union(ProofType) {
    single: SingleProofInput,
    compactMulti: CompactMultiProofInput,
};

pub const SingleProof = struct {
    leaf: [32]u8,
    witnesses: [][32]u8,

    pub fn deinit(self: *SingleProof, allocator: Allocator) void {
        allocator.free(self.witnesses);
        self.* = undefined;
    }
};

/// Returns true if the node is "opaque" — terminal in our PMT model but
/// represents a navigable subtree underneath (container_struct = deserialized
/// container struct; chunked_leaf = K packed chunks). Proof traversal must
/// materialize a temporary explicit subtree before walking inside.
inline fn isOpaqueNode(pool: *Node.Pool, node_id: Node.Id) bool {
    const kind = pool.nodes.items(.state)[@intFromEnum(node_id)].kind();
    return kind == .container_struct or kind == .chunked_leaf;
}

/// Materializes a temporary navigable subtree for an opaque node. Caller is
/// responsible for `unref`'ing the returned Id once the temporary tree is no
/// longer needed (single-proof and compact-multi-proof both park the Id in
/// a deferred-unref ArrayList).
inline fn materializeOpaque(pool: *Node.Pool, node_id: Node.Id) Node.Error!Node.Id {
    const kind = pool.nodes.items(.state)[@intFromEnum(node_id)].kind();
    return switch (kind) {
        .container_struct => try pool.materializeContainerStruct(node_id),
        .chunked_leaf => try pool.materializeChunkedLeaf(node_id),
        else => unreachable,
    };
}

/// Proof traversal needs real left/right child nodes. For an opaque node
/// (container_struct or chunked_leaf), materialize a temporary plain tree
/// and append it to the deferred-unref list so it stays alive until proof
/// creation finishes.
///
/// Materializing one opaque node can yield another. A single-field
/// StructContainerType has no enclosing branch, so its tree IS its only
/// field's tree; if that field is also opaque, the result is still opaque.
/// Loop until the node is navigable.
fn materializeIfOpaque(
    allocator: Allocator,
    pool: *Node.Pool,
    node_id: Node.Id,
    temporary_roots: *std.ArrayList(Node.Id),
) (Node.Error || Error)!Node.Id {
    var current = node_id;
    while (isOpaqueNode(pool, current)) {
        const materialized = try materializeOpaque(pool, current);
        errdefer pool.unref(materialized);

        try temporary_roots.append(allocator, materialized);
        current = materialized;
    }
    return current;
}

/// Produces a single Merkle proof for the node at `gindex`.
pub fn createSingleProof(
    allocator: Allocator,
    pool: *Node.Pool,
    root: Node.Id,
    gindex: Gindex,
) (Node.Error || Error)!SingleProof {
    if (@intFromEnum(gindex) < root_gindex_value) {
        return error.InvalidGindex;
    }

    const witnesses = try allocator.alloc([32]u8, gindex.pathLen());
    errdefer allocator.free(witnesses);

    return .{
        .leaf = try createSingleProofInto(allocator, pool, root, gindex, witnesses),
        .witnesses = witnesses,
    };
}

/// Writes the leaf-to-root branch into caller-owned storage and returns the leaf root.
/// Storage must match the path length and may be partially written on error.
/// Allocates only when traversal materializes opaque nodes.
pub fn createSingleProofInto(
    allocator: Allocator,
    pool: *Node.Pool,
    root: Node.Id,
    gindex: Gindex,
    witnesses: [][32]u8,
) (Node.Error || Error)![32]u8 {
    if (@intFromEnum(gindex) < root_gindex_value) {
        return error.InvalidGindex;
    }
    const path_len = gindex.pathLen();
    if (witnesses.len != path_len) {
        return error.InvalidWitnessLength;
    }

    // Nested opaque (container_struct → chunked_leaf, or any future combination)
    // is legal: e.g. StructContainerType holding a FixedVectorType with
    // .chunked_leaf=true. Track every materialized temporary root and unref
    // them on exit, matching createCompactMultiProof's pattern.
    var temporary_roots: std.ArrayList(Node.Id) = .empty;
    defer {
        for (temporary_roots.items) |temp_root| {
            pool.unref(temp_root);
        }
        temporary_roots.deinit(allocator);
    }

    if (path_len == 0) {
        return root.getRoot(pool).*;
    }

    var node_id = root;
    var path = gindex.toPath();

    for (0..path_len) |depth_idx| {
        const witness_index = path_len - 1 - depth_idx;

        node_id = try materializeIfOpaque(allocator, pool, node_id, &temporary_roots);

        if (path.left()) {
            const right_id = try node_id.getRight(pool);
            witnesses[witness_index] = right_id.getRoot(pool).*;
            node_id = try node_id.getLeft(pool);
        } else {
            const left_id = try node_id.getLeft(pool);
            witnesses[witness_index] = left_id.getRoot(pool).*;
            node_id = try node_id.getRight(pool);
        }

        path.next();
    }

    return node_id.getRoot(pool).*;
}

/// Build a fresh node tree from a single Merkle proof.
pub fn createNodeFromSingleProof(
    pool: *Node.Pool,
    gindex: Gindex,
    leaf: [32]u8,
    witnesses: []const [32]u8,
) (Node.Error || Error)!Node.Id {
    if (@intFromEnum(gindex) < root_gindex_value) {
        return error.InvalidGindex;
    }

    const path_len = gindex.pathLen();
    if (witnesses.len != path_len) {
        return error.InvalidWitnessLength;
    }

    var node_id = try pool.createLeaf(&leaf);
    errdefer pool.unref(node_id);
    var index_value: GindexUint = @intFromEnum(gindex);

    for (witnesses) |witness| {
        const sibling_id = try pool.createLeaf(&witness);
        errdefer pool.unref(sibling_id);

        node_id = try if ((index_value & 1) == 0)
            pool.createBranch(node_id, sibling_id)
        else
            pool.createBranch(sibling_id, node_id);

        index_value >>= 1;
    }

    // Raise the reference count so callers own the result.
    try pool.ref(node_id);
    return node_id;
}

/// Creates a proof based on the input type.
pub fn createProof(
    allocator: Allocator,
    pool: *Node.Pool,
    root: Node.Id,
    input: ProofInput,
) (Node.Error || Error)!Proof {
    switch (input) {
        .single => |single_input| {
            const single_proof = try createSingleProof(allocator, pool, root, single_input.gindex);
            return Proof{
                .single = .{
                    .gindex = single_input.gindex,
                    .leaf = single_proof.leaf,
                    .witnesses = single_proof.witnesses,
                },
            };
        },
        .compactMulti => |compact_input| {
            const leaves = try createCompactMultiProof(allocator, pool, root, compact_input.descriptor);
            return Proof{
                .compactMulti = .{
                    .leaves = leaves,
                    .descriptor = compact_input.descriptor,
                },
            };
        },
    }
}

/// Compact multi-proof result
pub const CompactMultiProof = struct {
    leaves: [][32]u8,
    descriptor: []u8,

    pub fn deinit(self: *CompactMultiProof, allocator: Allocator) void {
        allocator.free(self.leaves);
        allocator.free(self.descriptor);
        self.* = undefined;
    }
};

pub const Proof = union(ProofType) {
    single: struct {
        gindex: Gindex,
        leaf: [32]u8,
        witnesses: [][32]u8,
    },
    compactMulti: struct {
        leaves: [][32]u8,
        descriptor: []const u8,
    },

    pub fn deinit(self: *Proof, allocator: Allocator) void {
        switch (self.*) {
            .single => |*s| allocator.free(s.witnesses),
            .compactMulti => |*c| allocator.free(c.leaves),
        }
        self.* = undefined;
    }
};

/// Compute a packed descriptor from generalized indices.
pub fn computeDescriptor(allocator: Allocator, gindices: []const Gindex) ![]u8 {
    if (gindices.len == 0) return &.{};
    const max_entries = try std.math.mul(usize, gindices.len, @bitSizeOf(GindexUint));
    // Leave capacity headroom for the hash maps' u32 bucket counts.
    if (max_entries > std.math.maxInt(u32) / 4) return error.InvalidLength;
    for (gindices) |gindex| {
        if (@intFromEnum(gindex) == 0) return error.InvalidGindex;
    }

    var proof_indices = std.AutoHashMap(GindexUint, void).init(allocator);
    defer proof_indices.deinit();
    var path_indices = std.AutoHashMap(GindexUint, void).init(allocator);
    defer path_indices.deinit();

    for (gindices) |gindex| {
        var current = @intFromEnum(gindex);
        try proof_indices.put(current, {});
        // A gindex encodes left/right edges after its leading 1. Flip the last edge
        // to select the sibling, then discard that edge to ascend to the parent.
        for (0..gindex.pathLen()) |_| {
            try proof_indices.put(current ^ 1, {});
            current >>= 1;
            if (current > 1) try path_indices.put(current, {});
        }
        std.debug.assert(current == root_gindex_value);
    }

    var paths = path_indices.keyIterator();
    while (paths.next()) |path| _ = proof_indices.remove(path.*);
    std.debug.assert(proof_indices.count() <= max_entries);

    const sorted = try allocator.alloc(GindexUint, proof_indices.count());
    defer allocator.free(sorted);
    var indices = proof_indices.keyIterator();
    for (sorted) |*index| index.* = indices.next().?.*;
    std.debug.assert(indices.next() == null);

    std.sort.pdq(GindexUint, sorted, {}, struct {
        fn lessThan(_: void, a: GindexUint, b: GindexUint) bool {
            // Align leading bits to compare paths lexically, with shorter prefixes first.
            const a_aligned = a << @intCast(@clz(a));
            const b_aligned = b << @intCast(@clz(b));
            return if (a_aligned == b_aligned) a < b else a_aligned < b_aligned;
        }
    }.lessThan);

    var bit_count: usize = 0;
    for (sorted) |index| {
        bit_count = try std.math.add(usize, bit_count, @as(usize, @ctz(index)) + 1);
    }
    const byte_count = (try std.math.add(usize, bit_count, 7)) / 8;
    const descriptor = try allocator.alloc(u8, byte_count);
    @memset(descriptor, 0);

    var bit_index: usize = 0;
    for (sorted) |index| {
        bit_index += @ctz(index);
        descriptor[bit_index / 8] |= @as(u8, 0x80) >> @intCast(bit_index % 8);
        bit_index += 1;
    }
    std.debug.assert(bit_index == bit_count);
    return descriptor;
}

/// Get a bit from a byte array at the given bit index
fn getBit(bitlist: []const u8, bit_index: usize) bool {
    const byte_idx = bit_index / 8;
    const bit_idx = @as(u3, @intCast(bit_index % 8));
    const byte = bitlist[byte_idx];
    return (byte & (@as(u8, 0x80) >> bit_idx)) != 0;
}

fn validateDescriptor(descriptor: []const u8) Error!usize {
    const max_bit_length = std.math.mul(usize, descriptor.len, 8) catch return error.InvalidWitnessLength;
    var right_pending: [max_depth]bool = undefined;
    var depth: usize = 0;

    var i: usize = 0;
    while (i < max_bit_length) : (i += 1) {
        if (!getBit(descriptor, i)) {
            if (depth == max_depth) return error.InvalidProofDepth;
            right_pending[depth] = true;
            depth += 1;
            continue;
        }

        while (depth > 0) {
            if (right_pending[depth - 1]) {
                right_pending[depth - 1] = false;
                break;
            }
            depth -= 1;
        }

        if (depth == 0) {
            const bit_length = i + 1;
            if (max_bit_length - bit_length > 7) return error.InvalidWitnessLength;
            for (bit_length..max_bit_length) |padding_index| {
                if (getBit(descriptor, padding_index)) {
                    return error.InvalidWitnessLength;
                }
            }
            return bit_length;
        }
    }

    return error.InvalidWitnessLength;
}

/// Creates a compact multiproof for the given descriptor.
pub fn createCompactMultiProof(
    allocator: Allocator,
    pool: *Node.Pool,
    root: Node.Id,
    descriptor: []const u8,
) (Node.Error || Error)![][32]u8 {
    const bit_length = try validateDescriptor(descriptor);
    // Grow only for visited witnesses; a descriptor can request paths absent from the source.
    var leaves: std.ArrayList([32]u8) = .empty;
    errdefer leaves.deinit(allocator);

    var temporary_roots: std.ArrayList(Node.Id) = .empty;
    defer {
        for (temporary_roots.items) |temp_root| pool.unref(temp_root);
        temporary_roots.deinit(allocator);
    }

    var pending: [max_depth]Node.Id = undefined;
    var pending_count: usize = 0;
    var current = root;
    for (0..bit_length) |bit_index| {
        if (getBit(descriptor, bit_index)) {
            try leaves.append(allocator, current.getRoot(pool).*);
            if (pending_count == 0) {
                std.debug.assert(bit_index + 1 == bit_length);
                break;
            }
            pending_count -= 1;
            current = pending[pending_count];
        } else {
            current = try materializeIfOpaque(allocator, pool, current, &temporary_roots);
            std.debug.assert(pending_count < max_depth);
            pending[pending_count] = try current.getRight(pool);
            pending_count += 1;
            current = try current.getLeft(pool);
        }
    }
    std.debug.assert(leaves.items.len == bit_length / 2 + 1);
    std.debug.assert(pending_count == 0);
    return leaves.toOwnedSlice(allocator);
}

/// Creates a node from a compact multiproof, rejecting paths beyond `max_depth`.
pub fn createNodeFromCompactMultiProof(
    pool: *Node.Pool,
    leaves: [][32]u8,
    descriptor: []const u8,
) (Node.Error || Error)!Node.Id {
    const bit_length = try validateDescriptor(descriptor);
    if (leaves.len != bit_length / 2 + 1) return error.InvalidWitnessLength;

    var left_roots: [max_depth]?Node.Id = @splat(null);
    var depth: usize = 0;
    errdefer for (left_roots[0..depth]) |left| {
        if (left) |id| pool.unref(id);
    };

    var leaf_index: usize = 0;
    for (0..bit_length) |bit_index| {
        if (!getBit(descriptor, bit_index)) {
            std.debug.assert(depth < max_depth);
            left_roots[depth] = null;
            depth += 1;
            continue;
        }

        var current = try pool.createLeaf(&leaves[leaf_index]);
        errdefer pool.unref(current);
        leaf_index += 1;
        while (depth > 0) {
            const left = left_roots[depth - 1] orelse break;
            current = try pool.createBranch(left, current);
            left_roots[depth - 1] = null;
            depth -= 1;
        }
        if (depth == 0) {
            std.debug.assert(bit_index + 1 == bit_length);
            std.debug.assert(leaf_index == leaves.len);
            try pool.ref(current);
            return current;
        }
        left_roots[depth - 1] = current;
    }
    return error.InvalidWitnessLength;
}

test {
    _ = @import("proof_test.zig");
}
