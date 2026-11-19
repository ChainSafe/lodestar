const std = @import("std");
const Transport = @import("transport.zig").Transport;
const keys = @import("wire/keys.zig");
const Event = @import("quic/Engine.zig").Event;
const transport_driver = @import("transport_driver.zig");
const c = @import("quic/binding.zig").c;
const os = @import("builtin").os.tag;

pub const Node = struct {
    transport: Transport = .{},

    pub fn init(self: *Node, seed: u8) !void {
        const key = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{seed}));
        try self.transport.init(std.testing.allocator, std.testing.io, .{
            .host = &key,
            .bind = .{ .ip4 = .loopback(0) },
        });
        errdefer self.transport.deinit(std.testing.io);
        try singlePacketInitial(&self.transport);
    }

    pub fn deinit(self: *Node) void {
        self.transport.deinit(std.testing.io);
    }
};

/// Packet accounting tests need one Initial per connection, independent of TLS key-share defaults.
pub fn singlePacketInitial(transport: *Transport) !void {
    try std.testing.expectEqual(@as(c_int, 1), c.SSL_CTX_set1_groups_list(transport.engine.tls.ssl_ctx, "X25519"));
}

pub fn awaitDatagrams(socket: std.Io.net.Socket, count: usize) !void {
    if (os != .macos) return;
    const p = std.posix;
    const so_numrcvpkt = 0x1112;
    for (0..2_000) |_| {
        var queued: c_int = 0;
        var len: p.socklen_t = @sizeOf(c_int);
        if (p.errno(p.system.getsockopt(socket.handle, p.SOL.SOCKET, so_numrcvpkt, std.mem.asBytes(&queued), &len)) != .SUCCESS) return error.DatagramCountUnavailable;
        if (queued >= count) return;
        try std.testing.io.sleep(.fromMilliseconds(1), .awake);
    }
    return error.DatagramsNotDelivered;
}

pub fn step(transport: *Transport, io: std.Io, events: []Event, options: transport_driver.Options) transport_driver.Error!Transport.Progress {
    const result = transport_driver.step(transport, io, events, options);
    if (result.failure) |err| return err;
    return result.progress;
}
