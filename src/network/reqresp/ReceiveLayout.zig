//! Each authenticated connection has independently backed protocol reservations.
//! A selected request keeps its buffers across fork changes and execution admission.
//! Control responses reuse decoding scratch once their complete request has been admitted.
const std = @import("std");
const protocol = @import("protocol.zig");
const constants = @import("constants.zig");
const codec = @import("codec.zig");
const Policy = @import("request_policy.zig").Policy;
const Protocol = protocol.Protocol;

pub const slots_per_connection_max = Protocol.count * constants.MAX_CONCURRENT_REQUESTS;
comptime {
    std.debug.assert(slots_per_connection_max <= 64);
    std.debug.assert(slots_per_connection_max * constants.slots_ceiling <= std.math.maxInt(u16));
}
const read_max = 16 * 1024;
const handoff_max = @import("../negotiate.zig").Negotiator.inbox_capacity;

const Entry = struct {
    sink_offset: usize,
    io_offset: usize,
    sink_bytes: usize,
    scratch_bytes: usize,
    read_bytes: usize,
};

pub const Buffers = struct { sink: []u8, scratch: []u8, read: []u8 };

const ReceiveLayout = @This();

protocols: Protocol.Set,
slots_per_connection: u8,
entries: [Protocol.count]Entry,
sink_bytes: usize = 0,
io_bytes: usize = 0,

pub fn init(policy: *const Policy, protocols: Protocol.Set) ReceiveLayout {
    std.debug.assert(protocols.len() > 0);
    var layout: ReceiveLayout = .{ .protocols = protocols, .slots_per_connection = protocols.len() * constants.MAX_CONCURRENT_REQUESTS, .entries = undefined };
    for (std.enums.values(Protocol)) |which| {
        const index = protocols.index(which) orelse continue;
        const size = policy.requestMaxFor(which);
        const response_size = if (which.isControl()) which.info().response_max else 0;
        const scratch = codec.frameLengthMax(@min(constants.frame_uncompressed_max, @max(size, response_size, codec.error_message_max)));
        const read = @max(handoff_max, @min(read_max, codec.header_max + codec.frameLengthMax(@min(size, constants.frame_uncompressed_max))));
        layout.entries[index] = .{
            .sink_offset = layout.sink_bytes,
            .io_offset = layout.io_bytes,
            .sink_bytes = size,
            .scratch_bytes = scratch,
            .read_bytes = read,
        };
        layout.sink_bytes += constants.MAX_CONCURRENT_REQUESTS * size;
        layout.io_bytes += constants.MAX_CONCURRENT_REQUESTS * (scratch + read);
    }
    return layout;
}

pub fn first(self: *const ReceiveLayout, conn: u16, which: Protocol) usize {
    const index = self.protocols.index(which) orelse unreachable;
    return @as(usize, conn) * self.slots_per_connection + @as(usize, index) * constants.MAX_CONCURRENT_REQUESTS;
}

pub fn buffers(self: *const ReceiveLayout, index: usize, sinks: []u8, arena: []u8) Buffers {
    const conn = index / self.slots_per_connection;
    const entry = self.entries[(index % self.slots_per_connection) / constants.MAX_CONCURRENT_REQUESTS];
    const position = index % constants.MAX_CONCURRENT_REQUESTS;
    const sink_offset = conn * self.sink_bytes + entry.sink_offset + position * entry.sink_bytes;
    const io_offset = conn * self.io_bytes + entry.io_offset + position * (entry.scratch_bytes + entry.read_bytes);
    return .{
        .sink = sinks[sink_offset..][0..entry.sink_bytes],
        .scratch = arena[io_offset..][0..entry.scratch_bytes],
        .read = arena[io_offset + entry.scratch_bytes ..][0..entry.read_bytes],
    };
}

test "protocol subsets partition receive storage without duplicating buffers" {
    const fixture = @import("policy_fixture.zig");
    const policy = try Policy.init(&fixture.config());
    const all = ReceiveLayout.init(&policy, .all);
    const control = ReceiveLayout.init(&policy, .control);
    const application = ReceiveLayout.init(&policy, .application);
    try std.testing.expectEqual(14, control.slots_per_connection);
    try std.testing.expectEqual(26, application.slots_per_connection);
    try std.testing.expectEqual(all.slots_per_connection, control.slots_per_connection + application.slots_per_connection);
    try std.testing.expectEqual(all.sink_bytes, control.sink_bytes + application.sink_bytes);
    try std.testing.expectEqual(all.io_bytes, control.io_bytes + application.io_bytes);
    try std.testing.expectEqual(0, application.first(0, .blocks_by_range_v2));
    try std.testing.expectEqual(26, application.first(1, .blocks_by_range_v2));
    for ([_]ReceiveLayout{ control, application }) |layout| {
        const sinks = try std.testing.allocator.alloc(u8, 2 * layout.sink_bytes);
        defer std.testing.allocator.free(sinks);
        const arena = try std.testing.allocator.alloc(u8, 2 * layout.io_bytes);
        defer std.testing.allocator.free(arena);
        var sink_bytes: usize = 0;
        var io_bytes: usize = 0;
        for (0..2 * layout.slots_per_connection) |index| {
            const slices = layout.buffers(index, sinks, arena);
            try std.testing.expectEqual(@intFromPtr(sinks.ptr) + sink_bytes, @intFromPtr(slices.sink.ptr));
            try std.testing.expectEqual(@intFromPtr(arena.ptr) + io_bytes, @intFromPtr(slices.scratch.ptr));
            sink_bytes += slices.sink.len;
            io_bytes += slices.scratch.len + slices.read.len;
        }
        try std.testing.expectEqual(sinks.len, sink_bytes);
        try std.testing.expectEqual(arena.len, io_bytes);
    }
}
