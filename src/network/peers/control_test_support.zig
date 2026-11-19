const std = @import("std");
const Control = @import("control.zig").Control;
const Catalog = @import("catalog.zig").Catalog;
const types = @import("types.zig");
const rr = @import("../reqresp/root.zig");
const Pair = @import("../reqresp/test_pair.zig").Pair;
const Now = @import("../types.zig").Now;
const identify = @import("../identify/root.zig");

pub const Io = struct {
    pair: Pair = .{},
    handler: identify.Handler = undefined,

    pub fn init(self: *Io) !void {
        try self.pair.init(.{}, .{});
        errdefer self.pair.deinit();
        const local = try identify.Local.init(&self.pair.shared.pair.client_ctx.local_peer_id, "test", "v1", &.{});
        self.handler = try identify.Handler.init(std.testing.allocator, .{}, &local);
    }

    pub fn controlIo(self: *Io) Control.Io {
        return .{ .reqresp = &self.pair.shared.client.control_reqresp, .router = &self.pair.shared.client.router, .engine = &self.pair.shared.pair.client };
    }

    pub fn deinit(self: *Io) void {
        self.handler.shutdown(&self.pair.shared.client.router, &self.pair.shared.pair.client);
        self.handler.deinit();
        self.pair.deinit();
    }

    pub fn maintain(self: *Io, control: *Control, catalog: *Catalog, local: *const types.LocalState, now: Now) !void {
        self.pair.shared.pair.now = now;
        var closes: [256]Control.Close = undefined;
        const closed = control.maintain(catalog, local, &self.controlIo(), &self.handler, now, &closes);
        try std.testing.expectEqual(@as(usize, 0), closed.len);
    }

    pub fn receive(self: *Io, control: *Control, catalog: *Catalog, local: *const types.LocalState, event: rr.ReqResp.Event, now: Now, slot: u64) void {
        self.pair.shared.pair.now = now;
        control.receive(catalog, local, &self.controlIo(), &.{event}, now, slot);
    }

    pub fn release(self: *Io, control: *Control, peer: types.PeerRef, conn: types.Handle, now: Now) void {
        self.pair.shared.pair.now = now;
        std.debug.assert(control.releaseConnection(&self.controlIo(), peer, conn, now) == null);
    }

    /// Injects a decoded response into a real request slot, then delivers its chunk and terminal.
    pub fn reply(self: *Io, control: *Control, catalog: *Catalog, local: *const types.LocalState, request: rr.ReqResp.RequestHandle, bytes: []const u8, now: Now) !void {
        self.pair.shared.pair.now = now;
        const requests = &self.pair.shared.client.control_reqresp;
        const engine = &self.pair.shared.pair.client;
        const router = &self.pair.shared.client.router;
        const client = &requests.outbound[request.index];
        try std.testing.expectEqual(request, client.request.handle(request.index));
        @memcpy(client.request.io.sink[0..bytes.len], bytes);
        client.request.queue(.{ .chunk = .{ .request = request, .bytes = client.request.io.sink[0..bytes.len], .fork = null, .origin = .{ .connection = client.request.conn, .endpoint = null } } });
        client.complete(requests, engine, router, request.index, .{ .done = .{ .request = request, .chunks = 1 } }, now);
        for (0..2) |_| {
            var events: [1]rr.ReqResp.Event = undefined;
            try std.testing.expectEqual(@as(usize, 1), requests.pump(engine, router, now, &events));
            self.receive(control, catalog, local, events[0], now, 0);
        }
    }
};
