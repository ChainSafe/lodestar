const std = @import("std");
const Allocator = std.mem.Allocator;

const Node = @import("persistent_merkle_tree").Node;

/// Deserialize an SSZ container into its TreeView, while ignoring (not deserializing) selected
/// fields by name and overriding them with precomputed subtrees.
///
/// `overrides` should be a struct literal where field names match container field names,
/// e.g. `. { .validators = seed_validators_node }`. Its roots stay borrowed and must have a
/// retained owner throughout the call.
pub fn deserializeContainerOverrideFieldsWithRanges(
    allocator: Allocator,
    pool: *Node.Pool,
    comptime ContainerST: type,
    bytes: []const u8,
    ranges: *const [ContainerST.fields.len][2]usize,
    overrides: anytype,
) !*ContainerST.TreeView {
    var nodes: [ContainerST.chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
    var owned_nodes: [ContainerST.chunk_count]Node.Id = undefined;
    var owned_len: usize = 0;

    // Both builders borrow their inputs. Retain decoded fields while a partial build may
    // acquire and release its own references, including if TreeView initialization fails.
    defer {
        var i: usize = 0;
        while (i < owned_len) : (i += 1) pool.unref(owned_nodes[i]);
    }

    inline for (ContainerST.fields, 0..) |field, i| {
        const position = if (comptime ContainerST.kind == .progressive_container) ContainerST.field_indices[i] else i;
        if (comptime @hasField(@TypeOf(overrides), field.name)) {
            nodes[position] = @field(overrides, field.name);
            continue;
        }

        const start = ranges[i][0];
        const end = ranges[i][1];
        const field_bytes = bytes[start..end];

        const node = try field.type.tree.deserializeFromBytes(pool, field_bytes);
        pool.ref(node) catch |err| {
            pool.unref(node);
            return err;
        };
        nodes[position] = node;
        owned_nodes[owned_len] = node;
        owned_len += 1;
    }

    const root = if (comptime ContainerST.kind == .progressive_container)
        try ContainerST.tree.fromFieldNodes(pool, &nodes)
    else
        try Node.fillWithContents(pool, &nodes, ContainerST.chunk_depth);
    errdefer if (comptime ContainerST.kind == .progressive_container or ContainerST.chunk_depth > 0)
        pool.unref(root);
    return try ContainerST.TreeView.init(allocator, pool, root);
}

test {
    _ = @import("ssz_container_test.zig");
}
