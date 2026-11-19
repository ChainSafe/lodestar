const std = @import("std");
const test_allocator = if (@import("builtin").is_test) std.testing.allocator else std.heap.c_allocator;
const constants = @import("../constants.zig");
const Engine = @import("Engine.zig");
const keys = @import("../wire/keys.zig");
const tls = @import("../tls/context.zig");
const types = @import("../types.zig");
const time = @import("../time.zig");

const Event = Engine.Event;
const Limits = Engine.Limits;
const Now = Engine.Now;

pub const client_address = types.Address{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4_001 } };
pub const server_address = types.Address{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4_002 } };
pub const now_unix: i64 = 1_700_000_000;

pub const Pair = struct {
    const send_burst_max = 256;

    client_ctx: tls.Context = undefined,
    server_ctx: tls.Context = undefined,
    client: Engine = undefined,
    server: Engine = undefined,
    now: Now = Now.fromMilliseconds(.{ .mono_ms = 1_000, .unix_s = now_unix }),
    first_initial: [constants.datagram_size_max]u8 = undefined,
    first_initial_len: usize = 0,
    drop_to_server: bool = false,
    client_source: types.Address = client_address,
    drop_to_address: ?types.Address = null,
    /// Datagrams the client accepted from the server.
    client_accepted: u64 = 0,
    /// Datagrams delivered in either direction, including dropped ones.
    delivered: u64 = 0,
    batch: Batch = undefined,
    client_stash: Stash = .{},
    server_stash: Stash = .{},

    pub fn init(self: *Pair, client_limits: Limits, server_limits: Limits) !void {
        const client_key = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{1}));
        const server_key = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{2}));
        self.client_ctx = try tls.Context.init(&client_key, now_unix, [_]u8{1} ** 8);
        self.server_ctx = tls.Context.init(&server_key, now_unix, [_]u8{2} ** 8) catch |err| {
            self.client_ctx.deinit();
            return err;
        };
        self.client = Engine.init(test_allocator, .{
            .tls = self.client_ctx,
            .limits = client_limits,
            .local = .{ client_address, null },
            .seed = &@as([32]u8, @splat(1)),
        }) catch |err| {
            self.server_ctx.deinit();
            self.client_ctx.deinit();
            return err;
        };
        self.server = Engine.init(test_allocator, .{
            .tls = self.server_ctx,
            .limits = server_limits,
            .local = .{ server_address, null },
            .seed = &@as([32]u8, @splat(2)),
        }) catch |err| {
            self.client.deinit();
            self.server_ctx.deinit();
            return err;
        };
        self.now = Now.fromMilliseconds(.{ .mono_ms = 1_000, .unix_s = now_unix });
        self.first_initial_len = 0;
        self.drop_to_server = false;
        self.client_source = client_address;
        self.drop_to_address = null;
        self.client_stash = .{};
        self.server_stash = .{};
    }

    pub fn deinit(self: *Pair) void {
        self.server.deinit();
        self.client.deinit();
    }

    pub fn sendOne(self: *Pair, engine: *Engine, index: u16, out: []u8) ?[]u8 {
        return (engine.sendOne(index, self.now, out) orelse return null).bytes;
    }

    pub fn dial(self: *Pair) !Engine.Handle {
        return self.client.dial(
            &server_address,
            self.server_ctx.local_peer_id,
            self.now,
        );
    }

    pub fn advance(self: *Pair, ms: u64) void {
        self.now.monotonic = time.milliseconds(self.now.millis() + ms);
    }

    /// Delivers datagrams both ways and advances both engines until neither has output left.
    pub fn pump(self: *Pair) !void {
        var rounds: usize = 0;
        while (rounds < 64) : (rounds += 1) {
            const source = self.client_source;
            var moved = try self.transfer(&self.client, &self.server, source, self.drop_to_server);
            moved = try self.transfer(&self.server, &self.client, server_address, false) or moved;
            self.settle(&self.client);
            self.settle(&self.server);
            if (!moved and !self.client.backlog() and !self.server.backlog()) return;
        }
        return error.PumpDidNotSettle;
    }

    /// Delivers one engine's pending output to its peer.
    pub fn flush(self: *Pair, engine: *Engine) !void {
        if (engine == &self.client) {
            _ = try self.transfer(&self.client, &self.server, self.client_source, self.drop_to_server);
        } else _ = try self.transfer(&self.server, &self.client, server_address, false);
    }

    /// Advances one engine at the pair's clock.
    pub fn settle(self: *Pair, engine: *Engine) void {
        engine.advance(self.now);
    }

    /// Flushes the sender's dirty connections into the receiver, as the transport does.
    pub fn transfer(
        self: *Pair,
        from: *Engine,
        to: *Engine,
        from_address: types.Address,
        drop: bool,
    ) !bool {
        var moved = false;
        var remaining = from.dirtyCount();
        while (remaining > 0) : (remaining -= 1) {
            const index = from.nextDirty() orelse break;
            var replies: [send_burst_max]struct { bytes: [constants.datagram_size_max]u8, len: usize, from: types.Address } = undefined;
            var reply_count: usize = 0;
            var budget: u32 = 0;
            var drained = false;
            while (budget < send_burst_max) {
                const count = self.batch.fill(from, index, self.now);
                budget += count;
                moved = moved or count > 0;
                for (self.batch.outgoing[0..count]) |sent| {
                    const datagram = @constCast(sent.bytes);
                    if (from == &self.client and self.first_initial_len == 0) {
                        @memcpy(self.first_initial[0..datagram.len], datagram);
                    }
                    self.delivered += 1;
                    if (drop) continue;
                    if (self.drop_to_address) |blocked| if (sent.to.eql(blocked)) continue;
                    var response: [constants.datagram_size_max]u8 = undefined;
                    const outcome = to.receive(
                        datagram,
                        &from_address,
                        self.now,
                        &response,
                    );
                    if (from == &self.client and self.first_initial_len == 0 and outcome == .accepted) {
                        self.first_initial_len = datagram.len;
                    }
                    if (to == &self.client and outcome == .accepted) self.client_accepted += 1;
                    if (outcome == .retry) {
                        const reply = &replies[reply_count];
                        reply.* = .{ .bytes = undefined, .len = outcome.retry.len, .from = sent.to };
                        @memcpy(reply.bytes[0..outcome.retry.len], outcome.retry);
                        reply_count += 1;
                    }
                }
                if (count < constants.send_batch_max) {
                    drained = true;
                    break;
                }
            }
            from.sent(index, self.now, drained);
            // Replies re-dirty the sender after its burst ended, as a later turn would.
            for (replies[0..reply_count]) |*reply| {
                var out: [constants.datagram_size_max]u8 = undefined;
                _ = from.receive(reply.bytes[0..reply.len], &reply.from, self.now, &out);
            }
        }
        from.finishFlush(self.now);
        return moved;
    }

    /// Events polled by `streamEvents` wait here for the next `events` call.
    fn stash(self: *Pair, engine: *const Engine) *Stash {
        std.debug.assert(engine == &self.client or engine == &self.server);
        return if (engine == &self.client) &self.client_stash else &self.server_stash;
    }

    pub fn events(self: *Pair, engine: *Engine, storage: []Event) []Event {
        const held = self.stash(engine);
        // A polled close event must reach the test before its connection can be retired.
        if (held.len == 0) engine.releaseReported();
        const taken = @min(held.len, storage.len);
        @memcpy(storage[0..taken], held.events[0..taken]);
        std.mem.copyForwards(Event, held.events[0 .. held.len - taken], held.events[taken..held.len]);
        held.len -= taken;
        if (held.len > 0) return storage[0..taken];
        const polled = engine.pollEvents(storage[taken..]);
        held.noteStreams(storage[taken..][0..polled]);
        return storage[0 .. taken + polled];
    }

    /// Returns stream readiness and close events collected since the last call. Newly polled
    /// events remain available to `events`. The slice lasts until the next event operation.
    pub fn streamEvents(self: *Pair, engine: *Engine) []const Event {
        const held = self.stash(engine);
        const start = held.len;
        held.len += engine.pollEvents(held.events[start..]);
        held.noteStreams(held.events[start..held.len]);
        const pending = held.stream_events[0..held.stream_events_len];
        held.stream_events_len = 0;
        return pending;
    }
};

const Stash = struct {
    events: [256]Event = undefined,
    len: usize = 0,
    /// Stream events not yet returned by `streamEvents`.
    stream_events: [256]Event = undefined,
    stream_events_len: usize = 0,

    fn noteStreams(self: *Stash, polled: []const Event) void {
        for (polled) |event| {
            if (event != .stream_ready and event != .stream_closed) continue;
            // Harnesses that never consume stream events keep only the newest events.
            if (self.stream_events_len == self.stream_events.len) {
                const kept = self.stream_events.len / 2;
                std.mem.copyForwards(Event, self.stream_events[0..kept], self.stream_events[self.stream_events.len - kept ..]);
                self.stream_events_len = kept;
            }
            self.stream_events[self.stream_events_len] = event;
            self.stream_events_len += 1;
        }
    }
};

pub fn expectConnected(event: Event, direction: Engine.Direction, expected: *const tls.Context) !Engine.Handle {
    switch (event) {
        .connected => |connected| {
            try std.testing.expectEqual(direction, connected.direction);
            try std.testing.expect(connected.peer_id.eql(&expected.local_peer_id));
            return connected.conn;
        },
        else => return error.TestUnexpectedResult,
    }
}

pub fn connectPair(pair: *Pair) !struct { client: Engine.Handle, server: Engine.Handle } {
    _ = try pair.dial();
    try pair.pump();
    var storage: [8]Event = undefined;
    const client_handle = try expectConnected(pair.events(&pair.client, &storage)[0], .outbound, &pair.server_ctx);
    const server_handle = try expectConnected(pair.events(&pair.server, &storage)[0], .inbound, &pair.client_ctx);
    return .{ .client = client_handle, .server = server_handle };
}

pub fn expectStreamOpened(event: Event, conn: Engine.Handle) !Engine.StreamHandle {
    switch (event) {
        .stream_opened => |stream| {
            try std.testing.expectEqual(conn, stream.conn);
            return stream;
        },
        else => return error.TestUnexpectedResult,
    }
}

pub fn expectClosed(
    event: Event,
    conn: Engine.Handle,
    direction: Engine.Direction,
    peer: ?*const tls.Context,
) !Engine.CloseReason {
    switch (event) {
        .closed => |closed| {
            try std.testing.expectEqual(conn, closed.conn);
            try std.testing.expectEqual(direction, closed.direction);
            if (peer) |ctx| {
                try std.testing.expect(closed.peer_id != null);
                try std.testing.expect(closed.peer_id.?.eql(&ctx.local_peer_id));
            } else {
                try std.testing.expect(closed.peer_id == null);
            }
            return closed.reason;
        },
        else => return error.TestUnexpectedResult,
    }
}

pub fn expectStreamClosed(event: Event, stream: Engine.StreamHandle) !?u64 {
    switch (event) {
        .stream_closed => |closed| {
            try std.testing.expectEqual(stream, closed.stream);
            return closed.reset_code;
        },
        else => return error.TestUnexpectedResult,
    }
}

pub const Batch = struct {
    buffers: [constants.send_batch_max][constants.datagram_size_max]u8 = undefined,
    outgoing: [constants.send_batch_max]Engine.Sent = undefined,

    pub fn fill(self: *Batch, engine: *Engine, index: u16, now: Now) u8 {
        var count: u8 = 0;
        while (count < self.outgoing.len) : (count += 1) {
            self.outgoing[count] = engine.sendOne(index, now, &self.buffers[count]) orelse break;
        }
        return count;
    }
};
