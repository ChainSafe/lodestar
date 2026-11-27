const std = @import("std");
const Engine = @import("../quic/Engine.zig");
const StreamHandle = @import("../types.zig").StreamHandle;
const Client = @import("Client.zig");
const Server = @import("Server.zig");
const Options = @import("options.zig").Options;

/// The reverse half of ReqResp's ownership invariant: a stream route must name a live request
/// that holds this exact stream. Scanning only the request slots cannot find orphaned routes.
pub fn check(engine: *const Engine, routes: Options.Routes, outbound: []const Client, inbound: []const Server) error{ OrphanedRoute, MismatchedRoute }!void {
    for (engine.registry.slots, 0..) |*connection, conn_index| {
        // Closing connections retain streams for buffered reads until retirement.
        if (connection.state != .established or connection.closing != .none) continue;
        for (&connection.table.entries, 0..) |*entry, entry_index| {
            if (!entry.claimed or entry.closed_pending) continue;
            const record = if (entry.route.owner == routes.outbound)
                (if (entry.route.row < outbound.len) &outbound[entry.route.row].request else return error.OrphanedRoute)
            else if (entry.route.owner == routes.inbound)
                (if (entry.route.row < inbound.len) &inbound[entry.route.row].request else return error.OrphanedRoute)
            else
                continue;
            if (!record.occupied() or record.stream_owner != .protocol) return error.OrphanedRoute;
            const stream: StreamHandle = .{
                .conn = .{ .index = @intCast(conn_index), .generation = connection.generation },
                .id = entry.id,
                .slot = @intCast(entry_index),
            };
            if (!std.meta.eql(record.stream, stream)) return error.MismatchedRoute;
        }
    }
}

test {
    _ = @import("route_invariant_test.zig");
}
