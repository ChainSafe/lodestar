const std = @import("std");
const time = @import("../time.zig");
const codec = @import("codec.zig");
const Router = @import("../router.zig").Router;
const Engine = @import("../quic/Engine.zig");
const types = @import("../types.zig");
const PeerRef = types.PeerRef;
const Outbox = @import("../stream_io.zig").Outbox;
const PeerId = @import("../wire/peer_id.zig").PeerId;

pub const Handler = struct {
    allocator: std.mem.Allocator,
    inbound: []Inbound,
    outbound: []Outbound,
    local: codec.Local,
    stopped: bool = false,
    delivery_cursor: usize = 0,

    pub const Limits = struct {
        inbound_max: u16 = 2,
        outbound_max: u16 = 2,

        pub fn validate(self: Limits) error{InvalidLimits}!void {
            if (self.inbound_max == 0 or self.inbound_max > 64 or self.outbound_max == 0 or self.outbound_max > 64) return error.InvalidLimits;
        }
    };
    pub const Options = struct {
        inbound_max: u16 = 2,
        outbound_max: u16 = 2,
        agent: []const u8 = "",
        protocol_version: []const u8 = "ipfs/0.1.0",
        addresses: []const types.Address = &.{},

        pub const Error = codec.Error || error{InvalidLimits};

        pub fn validate(self: Options) Error!void {
            try self.limits().validate();
            try codec.Local.validate(self.agent, self.protocol_version, self.addresses);
        }

        pub fn limits(self: Options) Limits {
            return .{ .inbound_max = self.inbound_max, .outbound_max = self.outbound_max };
        }

        /// Resolve the complete local value at startup. Explicit addresses replace the usable
        /// bound fallback, and the result owns its text, key and encoded addresses.
        pub fn makeLocal(self: Options, peer: *const PeerId, bound: *const [2]?types.Address) Error!codec.Local {
            try self.limits().validate();
            if (self.addresses.len > 0) return codec.Local.init(peer, self.agent, self.protocol_version, self.addresses);
            var addresses: [2]types.Address = undefined;
            var count: usize = 0;
            for (bound) |address| if (address) |value| {
                if (!value.isUsable()) continue;
                addresses[count] = value;
                count += 1;
            };
            return codec.Local.init(peer, self.agent, self.protocol_version, addresses[0..count]);
        }
    };
    pub const Failure = enum { negotiation, malformed, timeout, reset, transport, shutdown };
    pub const Result = struct {
        peer: PeerRef,
        conn: Engine.Handle,
        outcome: union(enum) { success: codec.Metadata, failed: Failure },
    };
    pub const InitError = std.mem.Allocator.Error || error{InvalidLimits};
    pub const StartError = Router.Error || error{ PeerLimit, IdentifyCapacity, Stopped };
    const deadline_ms = 5_000;
    const outbound_steps_per_pump = 8;
    const Inbound = struct {
        stream: ?Engine.StreamHandle = null,
        deadline: u64 = 0,
        ready: bool = false,
        bytes: [codec.encoded_frame_max]u8 = undefined,
        outbox: Outbox = .{},

        fn close(self: *Inbound, engine: *Engine) void {
            const stream = self.stream orelse return;
            engine.closeStream(stream, types.app_error_normal);
            self.* = .{};
        }

        fn advance(self: *Inbound, engine: *Engine, now_ms: u64) void {
            const stream = self.stream orelse return;
            if (now_ms >= self.deadline) return self.close(engine);
            if (!self.ready) return;
            self.ready = false;
            const done = self.outbox.pump(engine, stream) catch return self.close(engine);
            self.ready = done == .yielded;
            if (done == .done) self.close(engine);
        }
    };
    const Outbound = struct {
        stream: ?Engine.StreamHandle = null,
        peer: PeerRef = undefined,
        deadline: u64 = 0,
        ready: bool = false,
        phase: enum { negotiating, reading, terminal } = .negotiating,
        sent_fin: bool = false,
        decoder: codec.Decoder = undefined,
        result: Result = undefined,

        fn finish(self: *Outbound, engine: *Engine, outcome: @FieldType(Result, "outcome")) void {
            const stream = self.stream.?;
            engine.closeStream(stream, types.app_error_normal);
            self.result = .{ .peer = self.peer, .conn = stream.conn, .outcome = outcome };
            self.phase = .terminal;
            self.ready = false;
        }

        fn cancel(self: *Outbound, router: *Router, engine: *Engine, failure: Failure) void {
            if (self.stream == null or self.phase == .terminal) return;
            if (self.phase == .negotiating) router.cancel(engine, self.stream.?);
            self.finish(engine, .{ .failed = failure });
        }

        fn advance(self: *Outbound, router: *Router, engine: *Engine, now_ms: u64) void {
            const stream = self.stream orelse return;
            if (self.phase == .terminal) return;
            if (now_ms >= self.deadline) return self.cancel(router, engine, .timeout);
            if (self.phase != .reading or !self.ready) return;
            for (0..outbound_steps_per_pump) |_| {
                self.ready = false;
                if (!self.sent_fin) {
                    // The responder may stop its unused request half before this empty FIN.
                    _ = engine.write(stream, &.{}, true) catch |err| switch (err) {
                        error.StreamStopped => 0,
                        error.WouldBlock => break,
                        else => {
                            self.finish(engine, .{ .failed = .transport });
                            break;
                        },
                    };
                    self.sent_fin = true;
                } else if (self.decoder.result()) |metadata| {
                    self.finish(engine, .{ .success = metadata });
                    break;
                } else {
                    var bytes: [2048]u8 = undefined;
                    const read = engine.read(stream, &bytes) catch |err| {
                        if (err != error.WouldBlock) self.finish(engine, .{ .failed = .transport });
                        break;
                    };
                    if (read.reset_code != null) {
                        self.finish(engine, .{ .failed = .reset });
                        break;
                    }
                    self.decoder.feed(bytes[0..read.len], read.fin) catch {
                        self.finish(engine, .{ .failed = .malformed });
                        break;
                    };
                    if (self.decoder.result()) |metadata| {
                        self.finish(engine, .{ .success = metadata });
                        break;
                    }
                    if (read.len == 0) break;
                }
                self.ready = true;
            }
        }
    };

    /// Copies a complete Local constructed for this transport identity. Each inbound stream
    /// encodes its own snapshot, so later publication cannot change an active response.
    pub fn init(allocator: std.mem.Allocator, options: Limits, local: *const codec.Local) InitError!Handler {
        try options.validate();
        const inbound = try allocator.alloc(Inbound, options.inbound_max);
        errdefer allocator.free(inbound);
        const outbound = try allocator.alloc(Outbound, options.outbound_max);
        errdefer allocator.free(outbound);
        @memset(inbound, .{});
        @memset(outbound, .{});
        return .{ .allocator = allocator, .inbound = inbound, .outbound = outbound, .local = local.* };
    }

    pub fn deinit(self: *Handler) void {
        self.allocator.free(self.outbound);
        self.allocator.free(self.inbound);
        self.* = undefined;
    }

    pub fn allocatedBytes(self: *const Handler) usize {
        return self.inbound.len * @sizeOf(Inbound) + self.outbound.len * @sizeOf(Outbound);
    }

    pub fn start(self: *Handler, router: *Router, engine: *Engine, peer: PeerRef, conn: Engine.Handle, now: types.Now) StartError!void {
        if (self.stopped) return error.Stopped;
        for (self.outbound) |*slot| if (slot.stream) |stream| {
            if (std.meta.eql(stream.conn, conn)) return error.PeerLimit;
        };
        var free: ?*Outbound = null;
        for (self.outbound) |*slot| if (slot.stream == null) {
            free = slot;
            break;
        };
        const slot = free orelse return error.IdentifyCapacity;
        const expected = engine.peerId(conn) orelse return error.StaleHandle;
        const stream = try router.beginOutbound(engine, conn, .identify, now);
        slot.* = .{ .stream = stream, .peer = peer, .deadline = now.millis() +| deadline_ms, .decoder = .init(&expected) };
    }

    /// A routed stream event. Inbound slot `i` is row `i`; outbound slot `j` is row
    /// `inbound.len + j`. An event for a stream the slot no longer holds is dropped.
    pub fn streamReady(self: *Handler, row: u24, stream: Engine.StreamHandle) void {
        if (row < self.inbound.len) {
            const slot = &self.inbound[row];
            if (slot.stream != null and std.meta.eql(slot.stream.?, stream)) slot.ready = true;
            return;
        }
        if (row - self.inbound.len >= self.outbound.len) return;
        const slot = &self.outbound[row - self.inbound.len];
        if (slot.stream != null and std.meta.eql(slot.stream.?, stream) and slot.phase == .reading) slot.ready = true;
    }

    pub fn transportEvents(self: *Handler, engine: *Engine, events: []const Engine.Event) void {
        for (events) |event| switch (event) {
            .closed => |closed| self.closeConnection(engine, closed.conn),
            else => {},
        };
    }

    fn bindRow(engine: *Engine, stream: Engine.StreamHandle, row: usize) void {
        // A stream that is already gone has no events to route.
        engine.bindStream(stream, .{ .owner = .identify, .row = @intCast(row) }) catch {};
    }

    fn closeConnection(self: *Handler, engine: *Engine, conn: Engine.Handle) void {
        for (self.inbound) |*slot| if (slot.stream) |stream| {
            if (std.meta.eql(stream.conn, conn)) {
                slot.close(engine);
            }
        };
        for (self.outbound) |*slot| if (slot.stream) |stream| {
            if (std.meta.eql(stream.conn, conn) and slot.phase != .terminal) slot.finish(engine, .{ .failed = .transport });
        };
    }

    pub fn negotiationResult(self: *Handler, router: *const Router, engine: *Engine, outcome: Router.Outcome, now: types.Now) void {
        if (outcome.direction == .outbound) {
            for (self.outbound, 0..) |*slot, index| if (std.meta.eql(slot.stream, outcome.stream) and slot.phase == .negotiating) {
                switch (outcome.result) {
                    .ready => |selected| {
                        bindRow(engine, outcome.stream, self.inbound.len + index);
                        slot.phase = .reading;
                        slot.ready = true;
                        slot.decoder.feed(selected.leftover, selected.fin) catch {
                            slot.finish(engine, .{ .failed = .malformed });
                            return;
                        };
                    },
                    else => slot.finish(engine, .{ .failed = .negotiation }),
                }
                return;
            };
            return;
        }
        if (outcome.result != .ready) return;
        const selected = outcome.result.ready;
        if (self.stopped or selected.leftover.len != 0) {
            engine.closeStream(outcome.stream, types.app_error_normal);
            return;
        }
        for (self.inbound) |*slot| if (slot.stream) |stream| {
            if (std.meta.eql(stream.conn, outcome.stream.conn)) {
                engine.closeStream(outcome.stream, types.app_error_normal);
                return;
            }
        };
        for (self.inbound, 0..) |*slot, index| if (slot.stream == null) {
            bindRow(engine, outcome.stream, index);
            slot.* = .{ .stream = outcome.stream, .deadline = now.millis() +| deadline_ms, .ready = true };
            const bytes = self.local.encode(router.capabilities().receive, engine.peerAddress(outcome.stream.conn), &slot.bytes) catch {
                slot.close(engine);
                return;
            };
            slot.outbox.queue(bytes, true);
            return;
        };
        engine.closeStream(outcome.stream, types.app_error_normal);
    }

    pub fn pump(self: *Handler, router: *Router, engine: *Engine, now: types.Now, out: []Result) usize {
        for (self.inbound) |*slot| slot.advance(engine, now.millis());
        var count: usize = 0;
        const start_index = self.delivery_cursor;
        for (0..self.outbound.len) |offset| {
            const index = (start_index + offset) % self.outbound.len;
            const slot = &self.outbound[index];
            slot.advance(router, engine, now.millis());
            if (slot.phase == .terminal and count < out.len) {
                out[count] = slot.result;
                count += 1;
                slot.* = .{};
                self.delivery_cursor = (index + 1) % self.outbound.len;
            }
        }
        return count;
    }

    pub fn schedule(self: *const Handler, result_capacity: usize) types.Schedule {
        var result: types.Schedule = .{};
        for (self.inbound) |*slot| if (slot.stream != null) {
            result = result.merge(.{ .runnable = slot.ready, .deadline = time.optionalMilliseconds(slot.deadline) });
        };
        for (self.outbound) |*slot| if (slot.stream != null) {
            if (slot.phase == .terminal) {
                result.runnable = result.runnable or result_capacity > 0;
                continue;
            }
            result = result.merge(.{
                .runnable = slot.phase == .reading and slot.ready,
                .deadline = time.optionalMilliseconds(slot.deadline),
            });
        };
        return result;
    }

    /// Permanently stops admission. Pump still delivers the cancelled outbound results.
    pub fn shutdown(self: *Handler, router: *Router, engine: *Engine) void {
        self.stopped = true;
        for (self.inbound) |*slot| slot.close(engine);
        for (self.outbound) |*slot| slot.cancel(router, engine, .shutdown);
    }
};

test {
    _ = @import("handler_options_test.zig");
    _ = @import("handler_protocols_test.zig");
    _ = @import("handler_test.zig");
}
