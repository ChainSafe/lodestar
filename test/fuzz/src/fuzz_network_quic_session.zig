const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x} (step {d}, op {d}, arg {d})\n", .{ text, addr, trace.step, trace.op, trace.arg });
    std.process.exit(99);
}

/// The step being executed, so a panic names the operation that triggered it.
var trace: struct { step: usize = 0, op: u8 = 0, arg: u8 = 0 } = .{};
const network = @import("network");
const fixture = @import("network_fixture");
const quic = network.quic;
const support = quic.testing;
const Engine = quic.Engine;
const Event = Engine.Event;
const StreamHandle = network.StreamHandle;
const assert = std.debug.assert;
const input_max = 4096;
const steps_max = 1024;
const streams_max = 16;
const extra_max = 1;
const dials_max = 1;
const write_max = 4096;
/// Loss recovery under a hostile loss policy can make one input move tens of thousands of
/// datagrams across the pair, several seconds under coverage instrumentation, so an input ends
/// once the pair has delivered this many.
const datagram_budget = 16_384;

var pair: support.Pair = .{};
var pattern: [write_max]u8 = undefined;
const Handles = struct { client: Engine.Handle, server: Engine.Handle };
var session: Handles = undefined;

const Side = enum { client, server };

/// Connections dialed during the input, one table per side: the client's dial handle and the
/// server's accepted one. Each handshake verifies a secp256k1 identity signature per side, which
/// costs more than the rest of an input, so `dials_max` bounds the handshakes that complete;
/// further dial attempts hit the dialing and connection limits and cost nothing.
const Extra = struct {
    handles: [extra_max]?Engine.Handle = @splat(null),

    fn add(self: *Extra, conn: Engine.Handle) void {
        for (&self.handles) |*slot| if (slot.* == null) {
            slot.* = conn;
            return;
        };
    }

    fn pick(self: *const Extra, at: usize) ?Engine.Handle {
        return self.handles[at % extra_max];
    }

    fn take(self: *Extra, at: usize) ?Engine.Handle {
        defer self.handles[at % extra_max] = null;
        return self.handles[at % extra_max];
    }
};

/// Moves the preloaded process clock (pkg/afl++/fuzz_clock.c) with the pair's logical clock so
/// quiche's timers track the harness; without the shim the symbol is null and only the pair moves.
const clock_advance = @extern(?*const fn (i64) callconv(.c) void, .{ .name = "fuzz_clock_advance", .linkage = .weak });

fn advanceTime(ms: u64) void {
    pair.advance(ms);
    if (clock_advance) |advance| advance(@intCast(ms * std.time.ns_per_ms));
}

const Streams = struct {
    handles: [streams_max]StreamHandle = undefined,
    len: usize = 0,

    fn add(self: *Streams, stream: StreamHandle) void {
        if (self.len == streams_max) return;
        for (self.handles[0..self.len]) |held| if (std.meta.eql(held, stream)) return;
        self.handles[self.len] = stream;
        self.len += 1;
    }

    fn pick(self: *const Streams, at: usize) ?StreamHandle {
        if (self.len == 0) return null;
        return self.handles[at % self.len];
    }
};

fn engine(side: Side) *Engine {
    return if (side == .client) &pair.client else &pair.server;
}

fn connHandle(handles: anytype, side: Side) Engine.Handle {
    return if (side == .client) handles.client else handles.server;
}

/// Polls one side's events, remembering peer-opened streams and accepted connections.
fn poll(side: Side, streams: *Streams, extra: *Extra) void {
    var storage: [64]Event = undefined;
    for (pair.events(engine(side), &storage)) |event| switch (event) {
        .stream_opened => |stream| streams.add(stream),
        .connected => |connected| if (connected.direction == .inbound) extra.add(connected.conn),
        else => {},
    };
}

/// Read-only views the host consults between operations; none may fault on a stale handle.
fn query(side: Side, conn: Engine.Handle, stream: ?StreamHandle) void {
    const e = engine(side);
    _ = e.peerId(conn);
    _ = e.peerAddress(conn);
    _ = e.receiveEndpoint(conn);
    _ = e.dialAnswered(conn);
    _ = e.resourceSnapshot();
    _ = e.metricsSnapshot();
    _ = e.nextDeadlineNs();
    _ = e.eventsPending();
    _ = e.backlog();
    _ = e.dirtyCount();
    if (stream) |handle| {
        _ = e.route(handle);
        _ = e.streamWaits(handle);
        _ = e.streamReadable(handle) catch {};
    }
}

fn checkInvariants() void {
    for ([_]*Engine{ &pair.client, &pair.server }) |e| {
        e.checkInvariants(pair.now);
        assert(e.registry.routes.count <= e.registry.active_len);
        assert(e.registry.active_len <= 2);
    }
}

/// Snapshot mode: the pair handshakes once before the fork server, so every input starts from
/// the same established connection. The loop freezes the process clock so quiche's timers do
/// not age that snapshot.
pub export fn zig_fuzz_init() callconv(.c) void {
    const limits: Engine.Limits = .{ .connections_max = 2, .handshaking_max = 1, .handshaking_per_source_max = 1, .dialing_max = 1 };
    pair.init(limits, limits) catch @panic("QUIC pair initialization failed");
    for (&pattern, 0..) |*byte, i| byte.* = @truncate(i *% 31);
    const fresh = support.connectPair(&pair) catch @panic("QUIC handshake failed");
    session = .{ .client = fresh.client, .server = fresh.server };
}

pub export fn zig_fuzz_test(input: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0 or len > input_max) return;
    var streams: [2]Streams = .{ .{}, .{} };
    var extra: [2]Extra = .{ .{}, .{} };
    var dials: usize = 0;
    var read_buffer: [write_max]u8 = undefined;
    var datagram: [network.constants.datagram_size_max]u8 = undefined;
    var output: [network.constants.datagram_size_max]u8 = undefined;
    var cursor = Cursor{ .bytes = input[0..len] };
    var steps: usize = 0;
    while (cursor.next()) |op| : (steps += 1) {
        if (steps == steps_max or pair.delivered >= datagram_budget) break;
        const arg = cursor.byte();
        trace = .{ .step = steps, .op = op % 19, .arg = arg };
        const side: Side = if (arg & 1 == 1) .server else .client;
        const other: Side = if (side == .client) .server else .client;
        const at = arg / 2;
        switch (op % 19) {
            0 => if (engine(side).openStream(connHandle(session, side))) |stream| {
                streams[@intFromEnum(side)].add(stream);
                _ = engine(side).write(stream, pattern[0 .. 1 + at % 64], at & 1 == 1) catch {};
            } else |_| {},
            1 => if (streams[@intFromEnum(side)].pick(at)) |stream| {
                const count = 1 + @as(usize, cursor.byte()) * 16;
                _ = engine(side).write(stream, pattern[0..@min(count, write_max)], at & 8 == 8) catch {};
            },
            2 => poll(side, &streams[@intFromEnum(side)], &extra[@intFromEnum(side)]),
            3 => if (streams[@intFromEnum(side)].pick(at)) |stream| {
                const result = engine(side).read(stream, read_buffer[0 .. 1 + @as(usize, at) * 8]) catch continue;
                assert(result.len <= 1 + @as(usize, at) * 8);
            },
            4 => if (streams[@intFromEnum(side)].pick(at)) |stream| {
                _ = engine(side).streamCapacity(stream) catch {};
            },
            5 => if (streams[@intFromEnum(side)].pick(at)) |stream| {
                engine(side).shutdown(stream, if (at & 2 == 2) .read else .write, at);
            },
            6 => if (streams[@intFromEnum(side)].pick(at)) |stream| {
                engine(side).closeStream(stream, at);
            },
            7 => {
                // Hostile bytes on an established path: unparseable, or a stale replay of the first Initial.
                const count = 1 + @as(usize, cursor.byte()) * 5;
                var size: usize = 0;
                if (at & 1 == 1 and pair.first_initial_len > 0) {
                    size = @min(pair.first_initial_len, datagram.len);
                    @memcpy(datagram[0..size], pair.first_initial[0..size]);
                    if (count < size) datagram[count] ^= 0x5a;
                } else {
                    size = @min(count, datagram.len);
                    for (datagram[0..size], 0..) |*byte, i| byte.* = cursor.byte() ^ @as(u8, @truncate(i));
                }
                const from = if (side == .server) support.client_address else support.server_address;
                _ = engine(side).receive(datagram[0..size], &from, pair.now, &output);
            },
            8 => {
                advanceTime(1 + @as(u64, at) * @as(u64, if (at > 100) 200 else 1));
                pair.settle(&pair.client);
                pair.settle(&pair.server);
            },
            9 => pair.pump() catch {},
            10 => _ = engine(side).close(connHandle(session, side), at),
            11 => if (streams[@intFromEnum(side)].pick(at)) |stream| {
                const owner: network.types.StreamOwner = @enumFromInt(1 + at % 8);
                engine(side).bindStream(stream, .{ .owner = owner, .row = at }) catch {};
            },
            12 => if (streams[@intFromEnum(other)].pick(at)) |stream| {
                // A handle from the wrong engine must be refused, never dereferenced.
                _ = engine(side).read(stream, &read_buffer) catch {};
                _ = engine(side).write(stream, pattern[0..1], false) catch {};
            },
            13 => if (at == 0 and (dials < dials_max or extra[0].pick(at) != null)) {
                if (pair.dial()) |conn| {
                    dials += 1;
                    extra[0].add(conn);
                } else |_| {}
            },
            14 => if (extra[@intFromEnum(side)].pick(at)) |conn| {
                if (engine(side).openStream(conn)) |stream| {
                    streams[@intFromEnum(side)].add(stream);
                    _ = engine(side).write(stream, pattern[0 .. 1 + at % 64], at & 1 == 1) catch {};
                } else |_| {}
            },
            15 => pair.drop_to_address = switch (at % 3) {
                0 => null,
                1 => support.client_address,
                else => support.server_address,
            },
            16 => if (extra[@intFromEnum(side)].take(at)) |conn| {
                if (at & 2 == 2) {
                    _ = engine(side).abandon(conn);
                } else _ = engine(side).close(conn, at);
            },
            17 => if (at & 2 == 2) engine(side).closeAll() else engine(side).stopAdmission(),
            18 => query(side, extra[@intFromEnum(side)].pick(at) orelse connHandle(session, side), streams[@intFromEnum(side)].pick(at)),
            else => unreachable,
        }
        checkInvariants();
    }
    teardown();
}

/// Fails every send, drains the close events and checks both registries end up empty. The fork
/// child owns a copy of the snapshot, so this checks cleanup for this input only.
fn teardown() void {
    for ([_]*Engine{ &pair.client, &pair.server }) |e| {
        for (e.registry.activeIndices()) |index| {
            const owner = e.sendOwner(index) orelse continue;
            _ = e.failSend(owner);
        }
    }
    var storage: [64]Event = undefined;
    for (0..64) |_| {
        var drained = true;
        for ([_]*Engine{ &pair.client, &pair.server }) |e| {
            if (pair.events(e, &storage).len > 0) drained = false;
            e.releaseReported();
        }
        if (drained) break;
    }
    for ([_]*Engine{ &pair.client, &pair.server }) |e| {
        assert(e.registry.active_len == 0 and e.registry.handshaking == 0);
        assert(e.registry.routes.count == 0);
    }
    pair.deinit();
}

const Cursor = struct {
    bytes: []const u8,
    offset: usize = 0,

    fn next(self: *Cursor) ?u8 {
        if (self.offset == self.bytes.len) return null;
        self.offset += 1;
        return self.bytes[self.offset - 1];
    }

    fn byte(self: *Cursor) u8 {
        return self.next() orelse 0;
    }
};
