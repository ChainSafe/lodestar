const std = @import("std");
const Buffer = @import("network_diagnostics.zig").Buffer;

test "diagnostic buffer allocation prefixes release all requested bytes" {
    for ([_]usize{ 64, 512 }) |capacity| {
        for ([_]usize{ 1, 615, 1082 }) |topics| {
            var measured = std.testing.FailingAllocator.init(std.testing.allocator, .{});
            const buffer = try Buffer.create(measured.allocator(), capacity, topics);
            try std.testing.expectEqual(Buffer.bytes(capacity, topics), measured.allocated_bytes);
            {
                const page = &buffer.gossip;
                try std.testing.expectEqual(topics, page.topics.len);
                for (page.peers) |peer| try std.testing.expectEqual(topics, peer.topics.len);
            }
            buffer.destroy();
            try std.testing.expectEqual(measured.allocated_bytes, measured.freed_bytes);
            for (0..measured.alloc_index) |prefix| {
                var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = prefix });
                try std.testing.expectError(error.OutOfMemory, Buffer.create(failing.allocator(), capacity, topics));
                try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
            }
        }
    }
}
