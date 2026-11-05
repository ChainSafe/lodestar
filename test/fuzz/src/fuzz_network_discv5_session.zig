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
const discv5 = @import("discv5");
const Engine = discv5.Engine;
const CallTable = discv5.CallTable;
const Channel = discv5.Channel;
const PendingResponse = discv5.PendingResponse;
const RoutingTable = discv5.RoutingTable;
const SessionStore = discv5.SessionStore;
const crypto = discv5.identity.crypto;
const enr = discv5.identity.enr;
const message = discv5.wire.message;
const constants = discv5.wire.constants;
const types = discv5.types;
const Address = types.Address;
const assert = std.debug.assert;
const input_max = 4096;
const steps_max = 1024;
const engines_max = 4;
const remotes_max = engines_max - 1;
const held_max = 4;
const pool_max = 32;
const link_max = 8;
const responses_max: usize = types.findnode_response_packets_max + 1;
const packet_max = constants.packet_size_max;
const payload_max = 1_200;
const time_start: u64 = 1_000;
/// Signature verifications and handshakes dominate an input's cost, several milliseconds each
/// under coverage instrumentation, so an input ends once it has caused this many. The slowest
/// recorded input then runs in about 1.5 s against a 5 s campaign timeout.
const crypto_budget = 128;
const allocator = std.heap.page_allocator;

/// Engine 0 is the node under test; the others are real peers that complete handshakes with it.
/// Its session store holds two peers, so the third handshake evicts one and later traffic must
/// recover through WHOAREYOU.
const local_config: Engine.Config = .{
    .session_capacity = 2,
    .challenge_capacity = 4,
    .call_capacity = held_max,
    .request_timeout_ms = 500,
    .challenge_timeout_ms = 500,
    .session_idle_timeout_ms = 10_000,
};
const remote_config: Engine.Config = .{
    .session_capacity = 4,
    .challenge_capacity = 4,
    .call_capacity = held_max,
    .request_timeout_ms = 500,
    .challenge_timeout_ms = 500,
    .session_idle_timeout_ms = 10_000,
};

var engines: [engines_max]Engine = undefined;
var scratches: [engines_max]Engine.Scratch = undefined;
var records: [engines_max]enr.Record = undefined;
var records_next: [engines_max]enr.Record = undefined;
var pool: [pool_max]enr.Record = undefined;
var pattern: [payload_max]u8 = undefined;
var now: u64 = time_start;
var seed_counter: u32 = 0;
var crypto_used: usize = 0;

const Datagram = struct {
    to: u8,
    from: Address,
    len: u16,
    bytes: [packet_max]u8,
};

/// The network between the engines: a bounded FIFO the input delivers, reorders, duplicates,
/// corrupts or drops. A full link loses the datagram, like a full socket buffer.
const Link = struct {
    slots: [link_max]Datagram = undefined,
    len: usize = 0,
    last: ?Datagram = null,

    fn push(self: *Link, to: u8, from: Address, bytes: []const u8) bool {
        if (self.len == link_max or bytes.len == 0 or bytes.len > packet_max) return false;
        const slot = &self.slots[self.len];
        slot.to = to;
        slot.from = from;
        slot.len = @intCast(bytes.len);
        @memcpy(slot.bytes[0..bytes.len], bytes);
        self.len += 1;
        return true;
    }

    fn take(self: *Link, at: usize) ?Datagram {
        if (self.len == 0) return null;
        const index = at % self.len;
        const taken = self.slots[index];
        std.mem.copyForwards(Datagram, self.slots[index .. self.len - 1], self.slots[index + 1 .. self.len]);
        self.len -= 1;
        return taken;
    }

    fn peek(self: *const Link, at: usize) ?Datagram {
        if (self.len == 0) return null;
        return self.slots[at % self.len];
    }
};

var link: Link = .{};

/// Every live call is held here, so `calls.count()` must equal the held count on each engine.
const Held = struct {
    handles: [held_max]?CallTable.Handle = @splat(null),

    fn add(self: *Held, handle: CallTable.Handle) bool {
        for (&self.handles) |*slot| if (slot.* == null) {
            slot.* = handle;
            return true;
        };
        return false;
    }

    fn remove(self: *Held, handle: CallTable.Handle) void {
        for (&self.handles) |*slot| if (slot.*) |live| if (std.meta.eql(live, handle)) {
            slot.* = null;
        };
    }

    fn pick(self: *const Held, at: usize) ?CallTable.Handle {
        return self.handles[at % held_max];
    }

    fn count(self: *const Held) usize {
        var total: usize = 0;
        for (self.handles) |slot| total += @intFromBool(slot != null);
        return total;
    }
};

var held: [engines_max]Held = @splat(.{});

const PendingTalk = struct { peer: types.Endpoint, request_id: message.RequestId };
var pending_talk: [engines_max]?PendingTalk = @splat(null);

fn address(index: usize) Address {
    return .{ .ip4 = .{ .octets = .{ 127, 0, 0, @intCast(1 + index) }, .port = @intCast(9_001 + index) } };
}

fn spoofed(at: u8) Address {
    return .{ .ip4 = .{ .octets = .{ 10, 0, at / 16, 1 + at % 16 }, .port = 30_303 } };
}

fn engineAt(from: Address) ?u8 {
    for (0..engines_max) |index| if (address(index).eql(from)) return @intCast(index);
    return null;
}

fn endpointOf(index: usize) types.Endpoint {
    return .{ .node_id = records[index].node_id, .address = address(index) };
}

fn poolEndpoint(record: *const enr.Record) ?types.Endpoint {
    return .{ .node_id = record.node_id, .address = record.endpoint() orelse return null };
}

fn nextSeed(byte: u8) u8 {
    seed_counter +%= 1;
    return @truncate((seed_counter *% 0x9e37) ^ byte);
}

fn sealEntropy(seed: u8) Channel.SealEntropy {
    return .{
        .masking_iv = @splat(seed),
        .nonce = @splat(seed +% 1),
        .nonce_tail = @splat(seed +% 2),
        .sessionless_key = @splat(seed +% 3),
    };
}

fn receiveArgs(seed: u8) Engine.ReceiveArgs {
    return .{ .now_ms = now, .entropy = .{
        .challenge = .{ .masking_iv = @splat(seed), .id_nonce = @splat(seed +% 1) },
        .handshake = .{ .masking_iv = @splat(seed +% 2), .nonce_tail = @splat(seed +% 3), .ephemeral_secret = @splat(seed +% 4) },
    } };
}

fn requestId(cursor: *Cursor) message.RequestId {
    const len = 1 + cursor.byte() % 8;
    var bytes: [8]u8 = undefined;
    for (bytes[0..len]) |*b| b.* = cursor.byte();
    return message.RequestId.init(bytes[0..len]) catch unreachable;
}

fn distance(byte: u8) u16 {
    return switch (byte % 8) {
        0 => 0,
        1 => 256,
        2 => 255,
        3 => 254,
        4 => 257,
        else => byte,
    };
}

/// Starts one call from `caller` to `callee` and puts the packet on the link.
fn startCall(caller: u8, callee: u8, cursor: *Cursor, kind: u8, seed: u8) void {
    if (held[caller].count() == held_max) return;
    var distances: [8]u16 = undefined;
    var request: message.Message = switch (kind % 3) {
        0 => .{ .ping = .{ .request_id = requestId(cursor), .enr_sequence = records[caller].sequence } },
        1 => blk: {
            const count = 1 + cursor.byte() % distances.len;
            for (distances[0..count]) |*d| d.* = distance(cursor.byte());
            break :blk .{ .find_node = .{ .request_id = requestId(cursor), .distances = distances[0..count] } };
        },
        else => blk: {
            const len = @min(payload_max, @as(usize, cursor.byte()) * 8);
            break :blk .{ .talk_request = .{ .request_id = requestId(cursor), .protocol = if (cursor.byte() & 1 == 1) "eth" else "", .request = pattern[0..len] } };
        },
    };
    var out: [packet_max]u8 = undefined;
    const started = engines[caller].startCall(&out, endpointOf(callee), &records[callee], &request, now, &sealEntropy(seed)) catch return;
    assert(held[caller].add(started.handle));
    _ = link.push(callee, address(caller), out[0..started.packet_length]);
}

fn removeHandle(index: u8, handle: CallTable.Handle) void {
    held[index].remove(handle);
}

/// Answers PING and FINDNODE the way Transport does; TALKREQ waits for the input to answer it.
fn respond(index: u8, request: *const Engine.AuthenticatedRequest, seed: u8) void {
    if (request.message == .talk_request) {
        pending_talk[index] = .{ .peer = request.peer, .request_id = request.message.talk_request.request_id };
        return;
    }
    var response: PendingResponse = .{};
    engines[index].prepareStandardResponse(request, &response) catch return;
    var out: [packet_max]u8 = undefined;
    for (0..responses_max) |_| {
        const len = (engines[index].encodeNextStandardResponse(&out, &response, now, &sealEntropy(seed)) catch return) orelse return;
        const to = engineAt(request.peer.address) orelse return;
        _ = link.push(to, address(index), out[0..len]);
    }
}

fn deliver(datagram: *const Datagram, seed: u8) void {
    const index = datagram.to;
    var out: [packet_max]u8 = undefined;
    const outcome = engines[index].receive(&out, datagram.bytes[0..datagram.len], datagram.from, receiveArgs(seed), &scratches[index]) catch return;
    const accepted = switch (outcome) {
        .accepted => |accepted| accepted,
        .rejected => return,
    };
    if (accepted.packet_length > 0) {
        crypto_used += 3;
        const sent = if (engineAt(datagram.from)) |to| link.push(to, address(index), out[0..accepted.packet_length]) else false;
        if (!sent) if (accepted.call) |handle| {
            const failed = engines[index].failCall(handle, error.HandshakeUnsent);
            removeHandle(index, failed.failed.handle);
            return;
        };
    }
    switch (accepted.event) {
        .none => {},
        .request => |*request| {
            if (request.record != null) crypto_used += 3;
            respond(index, request, seed);
        },
        .response => |response| {
            crypto_used += response.node_records.len;
            if (response.matched.terminal) removeHandle(index, response.matched.handle);
            for (response.node_records) |*record| {
                const peer = poolEndpoint(record) orelse continue;
                _ = engines[index].confirmPeer(&peer, record, now) catch {};
            }
        },
        .failed => |failed| removeHandle(index, failed.handle),
    }
}

fn expireAll() void {
    for (&engines, 0..) |*engine, index| {
        var expired: [held_max]CallTable.Expired = undefined;
        const counts = engine.expire(now, &expired);
        for (expired[0..counts.calls]) |entry| removeHandle(@intCast(index), entry.handle);
    }
}

fn advanceTime(ms: u64) void {
    now += ms;
    expireAll();
}

/// Read-only views the host consults between operations; none may fault.
fn query(index: u8, at: u8) void {
    const engine = &engines[index];
    const record = &pool[at % pool_max];
    _ = engine.localRecord();
    _ = engine.peerCount();
    _ = engine.nextDeadlineMs();
    _ = engine.isPeerBusy(&record.node_id);
    _ = engine.peerRecord(&record.node_id);
    _ = engine.channel.hasSession(endpointOf((index + 1) % engines_max));
    _ = engine.channel.requestCapacity(endpointOf((index + 1) % engines_max)) catch {};
    var cursor: usize = at;
    _ = engine.maintenanceTarget(&cursor, now, 1 + @as(u64, at) * 100);
    var closest: [RoutingTable.bucket_size]RoutingTable.Entry = undefined;
    _ = engine.closestNodes(&record.node_id, &closest);
    var found: [types.findnode_result_max]enr.Record = undefined;
    _ = engine.findNodes(spoofed(at), &.{ distance(at), distance(at +% 1) }, &found) catch {};
}

fn checkInvariants() void {
    for (&engines, 0..) |*engine, index| {
        assert(engine.calls.count() == held[index].count());
        for (held[index].handles) |slot| if (slot) |handle| assert(engine.calls.endpoint(handle) != null);
        assert(engine.channel.sessions.sessionCount() <= engine.config.session_capacity);
        assert(engine.channel.sessions.challengeCount() <= SessionStore.challenge_capacity_max);
        assert(engine.routing.count() <= RoutingTable.table_capacity);
    }
}

fn setup() !void {
    for (&pattern, 0..) |*byte, i| byte.* = @truncate(i *% 29);
    now = time_start;
    seed_counter = 0;
    crypto_used = 0;
    link = .{};
    held = @splat(.{});
    pending_talk = @splat(null);
    var keys: [engines_max]crypto.KeyPair = undefined;
    for (&keys, 0..) |*key, index| {
        key.* = try crypto.keyPairFromSecret(&(@as([32]u8, @splat(@intCast(0x11 * (index + 1))))));
        records[index] = try enr.Record.create(key, 1, address(index));
        records_next[index] = try enr.Record.create(key, 2, address(index));
    }
    for (&pool, 0..) |*record, index| {
        const key = try crypto.keyPairFromSecret(&(@as([32]u8, @splat(@intCast(0x50 + index)))));
        record.* = try enr.Record.create(&key, 1, .{ .ip4 = .{ .octets = .{ 192, 0, 2, @intCast(1 + index) }, .port = 30_303 } });
    }
    var initialized: usize = 0;
    errdefer for (engines[0..initialized]) |*engine| engine.deinit(allocator);
    for (&engines, 0..) |*engine, index| {
        try engine.init(allocator, keys[index], records[index], if (index == 0) local_config else remote_config);
        initialized += 1;
        scratches[index] = .{};
    }
    for (engines[1..]) |*engine| for (&pool) |*record| {
        const peer = poolEndpoint(record).?;
        _ = engine.confirmPeer(&peer, record, now) catch {};
    };
}

/// The snapshot starts with a session between the node and its first peer, so a cold handshake
/// and an established exchange are both one step away.
fn establish() void {
    var cursor = Cursor{ .bytes = &.{ 1, 1 } };
    startCall(0, 1, &cursor, 0, 0x40);
    for (0..8) |_| {
        const datagram = link.take(0) orelse break;
        deliver(&datagram, 0x60);
    }
    assert(engines[0].channel.hasSession(endpointOf(1)));
    assert(engines[1].channel.hasSession(endpointOf(0)));
    assert(engines[0].calls.count() == 0 and link.len == 0);
}

pub export fn zig_fuzz_init() callconv(.c) void {
    setup() catch @panic("discv5 engine initialization failed");
    establish();
}

pub export fn zig_fuzz_test(input: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0 or len > input_max) return;
    run(input[0..len]);
    teardown();
}

fn run(input: []const u8) void {
    crypto_used = 0;
    var cursor = Cursor{ .bytes = input };
    var steps: usize = 0;
    while (cursor.next()) |op| : (steps += 1) {
        if (steps == steps_max or crypto_used >= crypto_budget) break;
        const arg = cursor.byte();
        trace = .{ .step = steps, .op = op % 14, .arg = arg };
        const remote: u8 = 1 + arg % remotes_max;
        const outbound = arg & 4 == 4;
        const caller: u8 = if (outbound) 0 else remote;
        const callee: u8 = if (outbound) remote else 0;
        const seed = nextSeed(arg);
        switch (op % 14) {
            0 => startCall(caller, callee, &cursor, cursor.byte(), seed),
            1 => if (link.take(0)) |datagram| deliver(&datagram, seed),
            2 => if (link.take(arg)) |datagram| {
                deliver(&datagram, seed);
                link.last = datagram;
            },
            3 => if (link.peek(arg)) |datagram| deliver(&datagram, seed),
            4 => _ = link.take(arg),
            5 => if (link.take(arg)) |datagram| {
                var corrupt = datagram;
                const position = cursor.byte();
                corrupt.bytes[position % corrupt.len] ^= cursor.byte() | 1;
                if (arg & 8 == 8) corrupt.len = 1 + position % corrupt.len;
                deliver(&corrupt, seed);
            },
            6 => if (link.last) |datagram| {
                var replay = datagram;
                if (arg & 8 == 8) replay.from = spoofed(cursor.byte());
                if (arg & 16 == 16) replay.to = @intCast(cursor.byte() % engines_max);
                deliver(&replay, seed);
            },
            7 => advanceTime(1 + @as(u64, arg) * @as(u64, if (arg > 200) 100 else 1)),
            8 => {
                var datagram: Datagram = .{ .to = callee, .from = spoofed(cursor.byte()), .len = 0, .bytes = undefined };
                datagram.len = @intCast(1 + @as(usize, cursor.byte()) * 5);
                for (datagram.bytes[0..datagram.len], 0..) |*byte, i| byte.* = cursor.byte() ^ @as(u8, @truncate(i));
                deliver(&datagram, seed);
            },
            9 => if (link.last) |datagram| {
                const count = 1 + @as(usize, cursor.byte()) % 32;
                for (0..count) |i| {
                    var flood = datagram;
                    flood.from = spoofed(@intCast(i));
                    deliver(&flood, nextSeed(@intCast(i)));
                }
            },
            10 => if (held[caller].pick(arg / 8)) |handle| {
                if (arg & 8 == 8) {
                    const failed = engines[caller].failCall(handle, error.HandshakeUnsent);
                    removeHandle(caller, failed.failed.handle);
                } else if (engines[caller].cancelCall(handle)) removeHandle(caller, handle);
            },
            11 => if (pending_talk[callee]) |talk| {
                var out: [packet_max]u8 = undefined;
                var raw: [responses_max][]const u8 = undefined;
                const count = @as(usize, cursor.byte()) % raw.len;
                for (raw[0..count], 0..) |*bytes, i| bytes.* = pool[(arg + i) % pool_max].slice();
                if (arg & 8 == 8) crypto_used += count;
                const response: message.Message = if (arg & 8 == 8)
                    .{ .nodes = .{ .request_id = talk.request_id, .total = cursor.byte(), .enrs = raw[0..count] } }
                else
                    .{ .talk_response = .{ .request_id = talk.request_id, .response = pattern[0..@min(payload_max, @as(usize, cursor.byte()) * 8)] } };
                if (engines[callee].sendResponse(&out, talk.peer, &response, now, &sealEntropy(seed))) |len| {
                    if (engineAt(talk.peer.address)) |to| _ = link.push(to, address(callee), out[0..len]);
                } else |_| {}
                if (arg & 16 == 16) pending_talk[callee] = null;
            },
            12 => {
                const engine = &engines[callee];
                const record = &pool[cursor.byte() % pool_max];
                switch (arg / 8 % 4) {
                    0 => if (poolEndpoint(record)) |peer| {
                        _ = engine.confirmPeer(&peer, record, now) catch {};
                    },
                    1 => _ = engine.markPeerUnresponsive(&record.node_id, now),
                    2 => engine.updateLocalRecord(&records_next[callee]) catch {},
                    else => engine.updateLocalRecord(&records[callee]) catch {},
                }
            },
            13 => if (arg & 8 == 8) {
                if (engines[callee].nextDeadlineMs()) |deadline| if (deadline >= now) advanceTime(deadline - now + (arg & 1));
            } else query(callee, cursor.byte()),
            else => unreachable,
        }
        checkInvariants();
    }
}

/// Cancels every held call, which must still be live, and checks the engines end up empty.
fn teardown() void {
    for (&engines, 0..) |*engine, index| {
        for (held[index].handles) |slot| if (slot) |handle| assert(engine.cancelCall(handle));
        assert(engine.calls.count() == 0);
        engine.deinit(allocator);
    }
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

test "fuzz harness discv5 completes cold and warm exchanges and tears down empty" {
    try setup();
    establish();
    var ping = Cursor{ .bytes = &.{ 1, 7 } };
    startCall(0, 2, &ping, 0, 0x21);
    try std.testing.expectEqual(@as(usize, 1), held[0].count());
    for (0..8) |_| {
        const datagram = link.take(0) orelse break;
        deliver(&datagram, 0x31);
    }
    try std.testing.expect(engines[0].channel.hasSession(endpointOf(2)));
    try std.testing.expectEqual(@as(usize, 0), held[0].count());
    var find = Cursor{ .bytes = &.{ 1, 1, 2 } };
    startCall(0, 1, &find, 1, 0x41);
    for (0..32) |_| {
        const datagram = link.take(0) orelse break;
        deliver(&datagram, 0x51);
    }
    try std.testing.expectEqual(@as(usize, 0), held[0].count());
    try std.testing.expect(engines[0].peerCount() > 2);
    var talk = Cursor{ .bytes = &.{ 1, 9, 100, 1 } };
    startCall(3, 0, &talk, 2, 0x61);
    for (0..8) |_| {
        const datagram = link.take(0) orelse break;
        deliver(&datagram, 0x71);
    }
    try std.testing.expect(pending_talk[0] != null);
    try std.testing.expectEqual(@as(usize, 1), held[3].count());
    advanceTime(remote_config.request_timeout_ms + 1);
    try std.testing.expectEqual(@as(usize, 0), held[3].count());
    checkInvariants();
    run(&.{ 0, 4, 1, 1, 0, 9, 0, 1, 0, 0, 1, 0 });
    teardown();
}
