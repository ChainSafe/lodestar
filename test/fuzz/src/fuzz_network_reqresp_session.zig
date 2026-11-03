const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const network = @import("network");
const rr = network.reqresp;
const testing = rr.testing;
const ReqResp = rr.ReqResp;
const Protocol = rr.Protocol;
const RequestHandle = ReqResp.RequestHandle;
const Engine = network.Engine;
const Router = network.Router;
const StreamHandle = network.StreamHandle;
const Now = network.Now;
const assert = std.debug.assert;
const input_max = 8192;
const steps_max = 1024;
const outstanding_max = 8;
const inbound_max = 16;
const raw_max = 8;
const serving_max = 16;
const request_bytes_max = 1024;
const app_sink_bytes = 11 << 20;
const control_sink_bytes = 4096;
const app_sinks = 4;
const control_sinks = 4;

var pair: testing.Pair = .{};
var app_sink_storage: [app_sinks][app_sink_bytes]u8 = undefined;
var control_sink_storage: [control_sinks][control_sink_bytes]u8 = undefined;
var request_storage: [outstanding_max][request_bytes_max]u8 = undefined;
const inbound_slots = overrides.connections * rr.constants.MAX_CONCURRENT_REQUESTS *
    @max(Protocol.Set.application.len(), Protocol.Set.control.len());
var response_storage: [2][inbound_slots][16 * 1024]u8 = undefined;
var wire_bytes: [96]u8 = undefined;

const protocols = [_]Protocol{ .status_v1, .ping_v1, .metadata_v2, .blocks_by_range_v2, .blob_sidecars_by_range_v1, .blocks_by_root_v2, .goodbye_v1 };
const Side = enum { client, server };

/// Moves the preloaded process clock (pkg/afl++/fuzz_clock.c) with the pair's logical clock so
/// quiche's timers track the harness; without the shim the symbol is null and only the pair moves.
const clock_advance = @extern(?*const fn (i64) callconv(.c) void, .{ .name = "fuzz_clock_advance", .linkage = .weak });

fn advanceTime(ms: u64) void {
    pair.shared.pair.advance(ms);
    if (clock_advance) |advance| advance(@intCast(ms * std.time.ns_per_ms));
}
const Outstanding = struct { handle: RequestHandle, which: Protocol, sink: u8 };
const Inbound = struct { handle: RequestHandle, which: Protocol };

fn endpoint(side: Side) *testing.Endpoint {
    return if (side == .client) &pair.shared.client else &pair.shared.server;
}

fn engineOf(side: Side) *Engine {
    return if (side == .client) &pair.shared.pair.client else &pair.shared.pair.server;
}

fn owner(side: Side, which: Protocol) *ReqResp {
    return endpoint(side).requests(which);
}

fn checkInvariants() void {
    inline for (.{ Side.client, Side.server }) |side| {
        const e = endpoint(side);
        for ([_]*ReqResp{ &e.reqresp, &e.control_reqresp }) |instance| {
            rr.route_invariant.check(engineOf(side), instance.options.routes, instance.outbound, instance.inbound) catch unreachable;
            instance.checkInvariants(engineOf(side), pair.shared.pair.now, true);
            const counts = instance.pendingCounts();
            assert(counts.outbound <= instance.outbound.len and counts.inbound <= instance.inbound.len);
        }
    }
}

const State = struct {
    outstanding: [outstanding_max]Outstanding = undefined,
    outstanding_len: usize = 0,
    inbound: [inbound_max]Inbound = undefined,
    inbound_len: usize = 0,
    raw: [raw_max]StreamHandle = undefined,
    raw_len: usize = 0,
    serving: [serving_max]struct { which: Protocol, handle: ReqResp.ServingHandle } = undefined,
    serving_len: usize = 0,
    sink_used: [app_sinks + control_sinks]bool = @splat(false),

    fn sinkFor(self: *State, control: bool) ?u8 {
        const start: u8 = if (control) app_sinks else 0;
        const end: u8 = if (control) app_sinks + control_sinks else app_sinks;
        for (start..end) |i| if (!self.sink_used[i]) return @intCast(i);
        return null;
    }

    fn sink(index: u8) []u8 {
        return if (index < app_sinks) &app_sink_storage[index] else &control_sink_storage[index - app_sinks];
    }

    fn startRequest(self: *State, which: Protocol, arg: u8) ReqResp.RequestError!void {
        if (self.outstanding_len == outstanding_max) return;
        const sink_index = self.sinkFor(Protocol.Set.control.contains(which)) orelse return;
        const bytes = requestBytes(which, &request_storage[sink_index], arg);
        const timeouts: ReqResp.RequestOptions.Timeouts = .{
            .negotiation = .fromMilliseconds(100 + @as(i64, arg) * 4),
            .request = .fromMilliseconds(100 + @as(i64, arg) * 4),
            .response = if (arg & 0x80 != 0)
                (ReqResp.RequestOptions.Timeouts{}).response
            else
                .fromMilliseconds(200 + @as(i64, arg) * 8),
        };
        const handle = try owner(.client, which).request(engineOf(.client), &endpoint(.client).router, pair.shared.handles.client, which, bytes, sink(sink_index), .{ .timeouts = timeouts }, pair.shared.pair.now);
        self.outstanding[self.outstanding_len] = .{ .handle = handle, .which = which, .sink = sink_index };
        self.sink_used[sink_index] = true;
        self.outstanding_len += 1;
    }

    fn removeOutstanding(self: *State, control: bool, handle: RequestHandle) void {
        for (self.outstanding[0..self.outstanding_len], 0..) |entry, i| if (matches(entry.which, entry.handle, control, handle)) {
            self.sink_used[entry.sink] = false;
            self.outstanding_len -= 1;
            self.outstanding[i] = self.outstanding[self.outstanding_len];
            return;
        };
    }

    fn removeInbound(self: *State, control: bool, handle: RequestHandle) void {
        for (self.inbound[0..self.inbound_len], 0..) |entry, i| if (matches(entry.which, entry.handle, control, handle)) {
            self.inbound_len -= 1;
            self.inbound[i] = self.inbound[self.inbound_len];
            return;
        };
    }

    /// Runs one transport step and books the request lifecycle events it delivered.
    fn pump(self: *State) void {
        pair.pumpOnce() catch unreachable;
        for (pair.serverEvents(), 0..) |event, i| switch (event) {
            .request => |request| if (self.inbound_len < inbound_max) {
                self.inbound[self.inbound_len] = .{ .handle = request.request, .which = request.protocol };
                self.inbound_len += 1;
            },
            .served => |served| self.removeInbound(i >= pair.server_application_count, served.request),
            .failed => |failed| self.removeInbound(i >= pair.server_application_count, failed.request),
            else => {},
        };
        for (pair.clientEvents(), 0..) |event, i| switch (event) {
            .done => |done| self.removeOutstanding(i >= pair.client_application_count, done.request),
            .failed => |failed| self.removeOutstanding(i >= pair.client_application_count, failed.request),
            .chunk => |chunk| {
                for (self.outstanding[0..self.outstanding_len]) |entry| if (matches(entry.which, entry.handle, i >= pair.client_application_count, chunk.request)) {
                    const storage = State.sink(entry.sink);
                    assert(@intFromPtr(chunk.bytes.ptr) >= @intFromPtr(storage.ptr));
                    const offset = @intFromPtr(chunk.bytes.ptr) - @intFromPtr(storage.ptr);
                    assert(offset <= storage.len and chunk.bytes.len <= storage.len - offset);
                };
            },
            else => {},
        };
    }
};

fn matches(which: Protocol, expected: RequestHandle, control: bool, actual: RequestHandle) bool {
    return Protocol.Set.control.contains(which) == control and std.meta.eql(expected, actual);
}

fn requestBytes(which: Protocol, storage: []u8, arg: u8) []const u8 {
    switch (which) {
        .status_v1 => {
            storage[0..84].* = testing.statusBytes(arg);
            return storage[0..84];
        },
        .ping_v1, .goodbye_v1 => {
            std.mem.writeInt(u64, storage[0..8], arg, .little);
            return storage[0..8];
        },
        .metadata_v2 => return storage[0..0],
        .blocks_by_range_v2 => {
            std.mem.writeInt(u64, storage[0..8], 1 + @as(u64, arg) % 64, .little);
            std.mem.writeInt(u64, storage[8..16], 1 + @as(u64, arg) % 16, .little);
            std.mem.writeInt(u64, storage[16..24], 1, .little);
            return storage[0..24];
        },
        .blob_sidecars_by_range_v1 => {
            std.mem.writeInt(u64, storage[0..8], 1 + @as(u64, arg) % 64, .little);
            std.mem.writeInt(u64, storage[8..16], 1 + @as(u64, arg) % 4, .little);
            return storage[0..16];
        },
        .blocks_by_root_v2 => {
            const count = 1 + @as(usize, arg) % 4;
            @memset(storage[0 .. 32 * count], arg);
            return storage[0 .. 32 * count];
        },
        else => unreachable,
    }
}

fn respond(state: *State, index: usize, size: usize, seed: u8) void {
    const entry = state.inbound[index];
    const instance = owner(.server, entry.which);
    if (instance.responseReadiness(entry.handle) != .ready) return;
    const response = &response_storage[@intFromBool(Protocol.Set.control.contains(entry.which))][entry.handle.index];
    const now = pair.shared.pair.now;
    switch (entry.which) {
        .status_v1 => {
            response[0..84].* = testing.statusBytes(seed);
            instance.respond(entry.handle, response[0..84], null, now) catch {};
        },
        .ping_v1, .goodbye_v1 => {
            std.mem.writeInt(u64, response[0..8], seed, .little);
            instance.respond(entry.handle, response[0..8], null, now) catch {};
        },
        .metadata_v2 => {
            @memset(response[0..17], seed);
            instance.respond(entry.handle, response[0..17], null, now) catch {};
        },
        else => {
            const len = @min(size, response.len);
            @memset(response[0..len], seed);
            instance.respond(entry.handle, response[0..len], .{ .digest = testing.fulu_digest, .fork = .fulu }, now) catch {};
        },
    }
}

const overrides: testing.Overrides = .{
    .connections = 4,
    .outbound_max = 4,
    .serving_max = 4,
    .inbound_per_connection_max = 4,
    .control_outbound_max = 4,
    .serving_per_source_max = 2,
    .progress_timeout_ms = 300,
    .host_timeout_ms = 400,
    .quota_timeout_ms = 400,
    .request_fork = .fulu,
};

/// Snapshot mode: the pair connects once before the fork server, so every input starts from
/// the same established connections. The loop freezes the process clock so quiche's timers do
/// not age that snapshot.
pub export fn zig_fuzz_init() callconv(.c) void {
    pair.init(overrides, overrides) catch @panic("reqresp pair initialization failed");
}

pub export fn zig_fuzz_test(input: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0 or len > input_max) return;
    var state: State = .{};
    for (&wire_bytes, 0..) |*byte, i| byte.* = @truncate(i *% 13);

    var cursor = Cursor{ .bytes = input[0..len] };
    var steps: usize = 0;
    while (cursor.next()) |op| : (steps += 1) {
        if (steps == steps_max) break;
        const arg = cursor.byte();
        const now = pair.shared.pair.now;
        switch (op % 16) {
            0 => state.startRequest(protocols[arg % protocols.len], arg) catch {},
            1 => state.pump(),
            2 => if (state.inbound_len > 0) respond(&state, arg % state.inbound_len, 1 + @as(usize, cursor.byte()) * 64, arg),
            3 => if (state.inbound_len > 0) {
                const entry = state.inbound[arg % state.inbound_len];
                const codes = [_]u8{ 1, 2, 3, 128, 255, 0 };
                owner(.server, entry.which).respondError(entry.handle, codes[arg % codes.len], wire_bytes[0 .. @as(usize, arg) % 40], now) catch {};
            },
            4 => if (state.inbound_len > 0) {
                const entry = state.inbound[arg % state.inbound_len];
                _ = owner(.server, entry.which).finish(entry.handle, now);
            },
            5 => if (state.inbound_len > 0) {
                const entry = state.inbound[arg % state.inbound_len];
                _ = owner(.server, entry.which).cancel(engineOf(.server), &endpoint(.server).router, entry.handle, now);
            },
            6 => if (state.inbound_len > 0 and state.serving_len < serving_max) {
                const entry = state.inbound[arg % state.inbound_len];
                if (owner(.server, entry.which).retainServing(entry.handle)) |held| {
                    state.serving[state.serving_len] = .{ .which = entry.which, .handle = held };
                    state.serving_len += 1;
                }
            },
            7 => if (state.serving_len > 0) {
                const index = arg % state.serving_len;
                const held = state.serving[index];
                state.serving_len -= 1;
                state.serving[index] = state.serving[state.serving_len];
                _ = owner(.server, held.which).releaseServing(held.handle);
            },
            8 => if (state.outstanding_len > 0) {
                const entry = state.outstanding[arg % state.outstanding_len];
                _ = owner(.client, entry.which).cancel(engineOf(.client), &endpoint(.client).router, entry.handle, now);
            },
            9 => {
                advanceTime(1 + @as(u64, arg) * @as(u64, if (arg > 200) 20 else 1));
                state.pump();
            },
            10 => if (state.raw_len < raw_max) {
                const stream = pair.openRaw(protocols[arg % protocols.len]) catch continue;
                state.raw[state.raw_len] = stream;
                state.raw_len += 1;
            },
            11 => if (state.raw_len > 0) {
                const stream = state.raw[arg % state.raw_len];
                const count = 1 + @as(usize, cursor.byte()) % 96;
                for (wire_bytes[0..count]) |*byte| byte.* = cursor.byte();
                _ = engineOf(.client).write(stream, wire_bytes[0..count], arg & 8 == 8) catch {};
            },
            12 => if (state.inbound_len > 0) {
                // Bytes the server's own writer never produced, to exercise the client decoder.
                const entry = state.inbound[arg % state.inbound_len];
                const slot = &owner(.server, entry.which).inbound[entry.handle.index];
                if (std.meta.eql(slot.request.handle(entry.handle.index), entry.handle)) {
                    const count = 1 + @as(usize, cursor.byte()) % 96;
                    for (wire_bytes[0..count]) |*byte| byte.* = cursor.byte();
                    _ = engineOf(.server).write(slot.request.stream, wire_bytes[0..count], arg & 8 == 8) catch {};
                }
            },
            13 => if (state.outstanding_len > 0) {
                const entry = state.outstanding[arg % state.outstanding_len];
                _ = owner(.client, entry.which).consume(engineOf(.client), &endpoint(.client).router, entry.handle, now);
            },
            14 => if (arg & 1 == 1 and state.raw_len > 0) {
                const index = arg % state.raw_len;
                engineOf(.client).closeStream(state.raw[index], arg);
                state.raw_len -= 1;
                state.raw[index] = state.raw[state.raw_len];
            } else if (state.outstanding_len > 0) {
                const entry = state.outstanding[arg % state.outstanding_len];
                const slot = &owner(.client, entry.which).outbound[entry.handle.index];
                if (std.meta.eql(slot.request.handle(entry.handle.index), entry.handle)) engineOf(.client).closeStream(slot.request.stream, arg);
            },
            15 => for (0..3) |_| state.pump(),
            else => unreachable,
        }
        if (steps % 4 == 3) checkInvariants();
    }
    // Return the pair to rest: no requests, serving holds or raw streams outlive the iteration.
    inline for (.{ Side.client, Side.server }) |side| {
        const e = endpoint(side);
        for ([_]*ReqResp{ &e.reqresp, &e.control_reqresp }) |instance| instance.cancelAll(engineOf(side), &e.router, pair.shared.pair.now);
    }
    for (state.serving[0..state.serving_len]) |held| _ = owner(.server, held.which).releaseServing(held.handle);
    for (state.raw[0..state.raw_len]) |stream| engineOf(.client).closeStream(stream, 0);
    for (0..8) |_| {
        advanceTime(100);
        state.pump();
    }
    checkInvariants();
    assert(state.outstanding_len == 0 and state.inbound_len == 0);
    for (state.sink_used) |used| assert(!used);
    inline for (.{ Side.client, Side.server }) |side| {
        const e = endpoint(side);
        for ([_]*ReqResp{ &e.reqresp, &e.control_reqresp }) |instance| {
            const counts = instance.pendingCounts();
            assert(counts.outbound == 0 and counts.inbound == 0);
        }
    }
    // The fork child owns a copy of the snapshot, so its teardown checks cleanup for this input.
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

test "fuzz harness reqresp preserves instance identity and borrowed buffers" {
    try pair.init(overrides, overrides);
    defer pair.deinit();
    var state: State = .{};
    try state.startRequest(.blocks_by_range_v2, 7);
    try state.startRequest(.blocks_by_range_v2, 11);
    try state.startRequest(.ping_v1, 1);
    try std.testing.expectEqual(@as(usize, 3), state.outstanding_len);
    const application = state.outstanding[0];
    const survivor = state.outstanding[1];
    const payload = owner(.client, survivor.which).outbound[survivor.handle.index].request.io.payload;
    const expected = payload[0..24].*;
    const control = state.outstanding[2];
    try std.testing.expectEqual(application.handle, control.handle);
    try std.testing.expect(owner(.client, control.which).cancel(engineOf(.client), &endpoint(.client).router, control.handle, pair.shared.pair.now));
    for (0..16) |_| state.pump();
    try std.testing.expectEqual(@as(usize, 2), state.outstanding_len);
    try std.testing.expect(state.sink_used[application.sink]);
    try std.testing.expect(!state.sink_used[control.sink]);

    try std.testing.expect(owner(.client, application.which).cancel(engineOf(.client), &endpoint(.client).router, application.handle, pair.shared.pair.now));
    for (0..16) |_| state.pump();
    try std.testing.expectEqual(@as(usize, 1), state.outstanding_len);
    try std.testing.expectEqual(survivor.handle, state.outstanding[0].handle);
    try state.startRequest(.blocks_by_range_v2, 19);
    try std.testing.expectEqual(@as(usize, 2), state.outstanding_len);
    try std.testing.expectEqualSlices(u8, &expected, payload);

    for (0..64) |_| {
        state.pump();
        if (state.inbound_len == 2) break;
    }
    try std.testing.expectEqual(@as(usize, 2), state.inbound_len);
    respond(&state, 0, 8192, 41);
    const entry = state.inbound[0];
    const io = &owner(.server, entry.which).inbound[entry.handle.index].request.io;
    try std.testing.expect(io.writing);
    const first = io.writer.ssz;
    try std.testing.expectEqual(@as(usize, 8192), first.len);
    respond(&state, 1, 12288, 42);
    respond(&state, 0, 8192, 43);
    for (first) |byte| try std.testing.expectEqual(@as(u8, 41), byte);
}
