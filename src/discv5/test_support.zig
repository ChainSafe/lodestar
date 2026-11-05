const std = @import("std");
const Channel = @import("Channel.zig");
const crypto = @import("identity/crypto.zig");
const Engine = @import("Engine.zig");
const enr = @import("identity/enr.zig");
const SessionStore = @import("SessionStore.zig");
const types = @import("types.zig");

pub fn keyPair(seed: u8) !crypto.KeyPair {
    return crypto.keyPairFromSecret(&([_]u8{seed} ** 32));
}

pub fn address4(a: u8, b: u8, c: u8, d: u8, port: u16) types.Address {
    return .{ .ip4 = .{ .octets = .{ a, b, c, d }, .port = port } };
}

pub fn address6(octets: [16]u8, port: u16) types.Address {
    return .{ .ip6 = .{ .octets = octets, .port = port } };
}

pub fn loopback(id: u8, port: u16) types.Address {
    return address4(127, 0, 0, id, port);
}

pub fn endpoint(rec: *const enr.Record) types.Endpoint {
    return .{ .node_id = rec.node_id, .address = rec.endpoint().? };
}

pub fn fakeEndpoint(id: u8, port: u16) types.Endpoint {
    return .{ .node_id = [_]u8{id} ** 32, .address = loopback(id, port) };
}

pub fn fakeRecord(node_id: types.NodeId, address: types.Address, sequence: u64) enr.Record {
    var rec = std.mem.zeroes(enr.Record);
    rec.node_id = node_id;
    rec.sequence = sequence;
    switch (address) {
        .ip4 => |value| {
            rec.ip4 = value.octets;
            rec.udp = value.port;
        },
        .ip6 => |value| {
            rec.ip6 = value.octets;
            rec.udp6 = value.port;
        },
    }
    return rec;
}

pub fn installSession(core: *Engine, peer: types.Endpoint, key_byte: u8) void {
    const key = [_]u8{key_byte} ** 16;
    const active = SessionStore.Session{ .read_key = key, .write_key = key };
    core.channel.sessions.install(peer, &active, 0);
}

pub fn sealEntropy(seed: u8) Channel.SealEntropy {
    return .{
        .masking_iv = [_]u8{seed} ** 16,
        .nonce = [_]u8{seed +% 1} ** 12,
        .nonce_tail = [_]u8{seed +% 2} ** 8,
        .sessionless_key = [_]u8{seed +% 3} ** 16,
    };
}

pub fn challengeEntropy(seed: u8) Channel.ChallengeEntropy {
    return .{
        .masking_iv = [_]u8{seed} ** 16,
        .id_nonce = [_]u8{seed +% 1} ** 16,
    };
}

pub fn handshakeEntropy(seed: u8) Channel.HandshakeEntropy {
    return .{
        .masking_iv = [_]u8{seed} ** 16,
        .nonce_tail = [_]u8{seed +% 1} ** 8,
        .ephemeral_secret = [_]u8{seed +% 2} ** 32,
    };
}

pub fn receiveArgs(now_ms: u64, seed: u8) Engine.ReceiveArgs {
    return .{
        .now_ms = now_ms,
        .entropy = .{
            .challenge = challengeEntropy(seed),
            .handshake = handshakeEntropy(seed +% 2),
        },
    };
}

pub fn engineConfig() Engine.Config {
    return .{
        .session_capacity = 4,
        .challenge_capacity = 4,
        .call_capacity = 4,
        .request_timeout_ms = 100,
        .challenge_timeout_ms = 100,
        .session_idle_timeout_ms = 1_000,
    };
}

pub fn channelConfig() Channel.Config {
    return .{
        .session_capacity = 4,
        .challenge_capacity = 4,
        .challenge_timeout_ms = 100,
        .session_idle_timeout_ms = 1_000,
    };
}

pub const ManualIo = struct {
    sockets: [2]bool = @splat(false),
    now_ms: u64 = 0,
    receive_advance_ms: u64 = 0,
    receive_failure: ?std.Io.Batch.AwaitConcurrentError = null,
    datagram: ?struct { from: types.Address, bytes: []const u8, truncated: bool = false } = null,
    poll_ms: ?i64 = null,

    pub fn io(self: *ManualIo) std.Io {
        const vtable = comptime blk: {
            var value = std.Io.failing.vtable.*;
            value.now = now;
            value.netBindIp = bind;
            value.netClose = close;
            value.randomSecure = random;
            value.netSend = send;
            value.batchAwaitConcurrent = receive;
            value.batchCancel = cancel;
            break :blk value;
        };
        return .{ .userdata = self, .vtable = &vtable };
    }

    fn bind(context: ?*anyopaque, address: *const std.Io.net.IpAddress, options: std.Io.net.IpAddress.BindOptions) std.Io.net.IpAddress.BindError!std.Io.net.Socket {
        const self: *ManualIo = @ptrCast(@alignCast(context.?));
        std.debug.assert(address.* == .ip4 and address.getPort() == 0);
        std.debug.assert(options.mode == .dgram and options.protocol == .udp);
        for (&self.sockets, 0..) |*live, i| {
            if (live.*) continue;
            live.* = true;
            var bound = address.*;
            bound.ip4.port = @intCast(9_001 + i);
            return .{ .handle = @intCast(i + 1), .address = bound };
        }
        return error.SystemResources;
    }

    fn close(context: ?*anyopaque, handles: []const std.Io.net.Socket.Handle) void {
        const self: *ManualIo = @ptrCast(@alignCast(context.?));
        for (handles) |handle| {
            std.debug.assert(handle > 0 and handle <= self.sockets.len);
            const live = &self.sockets[@intCast(handle - 1)];
            std.debug.assert(live.*);
            live.* = false;
        }
    }

    fn now(context: ?*anyopaque, _: std.Io.Clock) std.Io.Timestamp {
        const self: *ManualIo = @ptrCast(@alignCast(context.?));
        return .{ .nanoseconds = @as(i96, self.now_ms) * std.time.ns_per_ms };
    }

    fn random(_: ?*anyopaque, bytes: []u8) std.Io.RandomSecureError!void {
        @memset(bytes, 0x11);
    }

    fn send(_: ?*anyopaque, _: std.Io.net.Socket.Handle, messages: []std.Io.net.OutgoingMessage, _: std.Io.net.SendFlags) struct { ?std.Io.net.Socket.SendError, usize } {
        return .{ null, messages.len };
    }

    fn receive(context: ?*anyopaque, batch: *std.Io.Batch, timeout: std.Io.Timeout) std.Io.Batch.AwaitConcurrentError!void {
        const self: *ManualIo = @ptrCast(@alignCast(context.?));
        self.poll_ms = timeout.duration.raw.toMilliseconds();
        self.now_ms += self.receive_advance_ms;
        if (self.receive_failure) |err| return err;
        const datagram = self.datagram orelse return error.Timeout;
        self.datagram = null;
        std.debug.assert(batch.storage.len == 1);
        std.debug.assert(batch.submitted.head == std.Io.Operation.OptionalIndex.fromIndex(0));
        const operation = batch.storage[0].submission.operation.net_receive;
        std.debug.assert(datagram.bytes.len <= operation.data_buffer.len);
        @memcpy(operation.data_buffer[0..datagram.bytes.len], datagram.bytes);
        operation.message_buffer[0] = .{
            .from = datagram.from.toNetwork(),
            .data = operation.data_buffer[0..datagram.bytes.len],
            .control = &.{},
            .flags = .{ .eor = false, .trunc = datagram.truncated, .ctrunc = false, .oob = false, .errqueue = false },
        };
        batch.storage[0] = .{ .completion = .{ .node = .{ .next = .none }, .result = .{ .net_receive = .{ null, 1 } } } };
        batch.submitted = .empty;
        batch.completed = .{ .head = .fromIndex(0), .tail = .fromIndex(0) };
    }

    fn cancel(_: ?*anyopaque, batch: *std.Io.Batch) void {
        std.debug.assert(batch.pending.head == .none);
    }
};
