const std = @import("std");

const Gindex = @import("gindex.zig").Gindex;
const View = @import("View.zig");
const Node = @import("Node.zig");

test "View" {
    const allocator = std.testing.allocator;
    var node_pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 10 });
    defer node_pool.deinit();

    var pool = try View.Pool.init(allocator, 10, &node_pool);
    defer pool.deinit();
    const p = &pool;

    // Create a root node (z(3))
    const root_node: Node.Id = @enumFromInt(3);

    const view_1 = try pool.create(root_node, null);
    const view_2 = try view_1.createSubview(p, Gindex.fromDepth(3, 0));

    try std.testing.expectEqual(@as(Node.Id, @enumFromInt(3)), view_1.getRootNode(p));
    try std.testing.expectEqual(@as(Node.Id, @enumFromInt(0)), view_2.getRootNode(p));
    try std.testing.expectEqual(@as(Node.Id, @enumFromInt(3)), view_2.getParent(p).?.root_view.getRootNode(p));

    // setting the child updates the parent
    try view_2.setRootNode(p, @enumFromInt(5));
    try std.testing.expect(@as(Node.Id, @enumFromInt(3)) != view_1.getRootNode(p));

    // setting the parent updates the child
    try view_1.setNode(p, Gindex.fromDepth(3, 0), @enumFromInt(0));
    try std.testing.expectEqual(@as(Node.Id, @enumFromInt(0)), view_2.getRootNode(p));

    pool.destroy(view_2);
    pool.destroy(view_1);
}
