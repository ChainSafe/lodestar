const std = @import("std");
const Address = @import("udp").Address;
const Network = @This();
const assert = std.debug.assert;

now_ms: u64 = 0,
random: std.Random.DefaultPrng = .init(42),
sockets: [8]Socket = @splat(.{}),

const Socket = struct {
    address: ?std.Io.net.IpAddress = null,
    queue: [32]Datagram = undefined,
    head: usize = 0,
    count: usize = 0,
};
const Datagram = struct { from: std.Io.net.IpAddress, bytes: [1280]u8, len: usize };

pub fn io(self: *Network) std.Io {
    const vtable = comptime blk: {
        var value = std.Io.failing.vtable.*;
        value.now = now;
        value.randomSecure = entropy;
        value.netBindIp = bind;
        value.netClose = close;
        value.netSend = send;
        value.batchAwaitConcurrent = receive;
        value.batchCancel = cancel;
        break :blk value;
    };
    return .{ .userdata = self, .vtable = &vtable };
}

fn context(userdata: ?*anyopaque) *Network {
    return @ptrCast(@alignCast(userdata.?));
}

fn now(userdata: ?*anyopaque, _: std.Io.Clock) std.Io.Timestamp {
    return .{ .nanoseconds = @as(i96, context(userdata).now_ms) * std.time.ns_per_ms };
}

fn entropy(userdata: ?*anyopaque, bytes: []u8) std.Io.RandomSecureError!void {
    context(userdata).random.random().bytes(bytes);
}

fn bind(userdata: ?*anyopaque, address: *const std.Io.net.IpAddress, options: std.Io.net.IpAddress.BindOptions) std.Io.net.IpAddress.BindError!std.Io.net.Socket {
    const self = context(userdata);
    assert(address.getPort() == 0);
    assert(options.mode == .dgram and options.protocol == .udp);
    for (&self.sockets, 0..) |*socket, index| {
        if (socket.address != null) continue;
        var bound = address.*;
        bound.setPort(@intCast(19_000 + index));
        socket.* = .{ .address = bound };
        return .{ .address = bound, .handle = @intCast(index + 1) };
    }
    return error.SystemResources;
}

fn close(userdata: ?*anyopaque, handles: []const std.Io.net.Socket.Handle) void {
    const self = context(userdata);
    for (handles) |handle| self.liveSocket(handle).* = .{};
}

fn liveSocket(self: *Network, handle: std.Io.net.Socket.Handle) *Socket {
    assert(handle > 0 and handle <= self.sockets.len);
    const result = &self.sockets[@intCast(handle - 1)];
    assert(result.address != null);
    return result;
}

fn send(userdata: ?*anyopaque, handle: std.Io.net.Socket.Handle, messages: []std.Io.net.OutgoingMessage, _: std.Io.net.SendFlags) struct { ?std.Io.net.Socket.SendError, usize } {
    const self = context(userdata);
    const from = self.liveSocket(handle).address.?;
    assert(messages.len <= 32);
    for (messages) |message| {
        assert(message.data_len <= 1280);
        const destination = Address.fromNetwork(message.address.*);
        for (&self.sockets) |*target| {
            const address = target.address orelse continue;
            if (!destination.eql(Address.fromNetwork(address))) continue;
            assert(target.count < target.queue.len);
            const datagram = &target.queue[(target.head + target.count) % target.queue.len];
            datagram.from = from;
            datagram.len = message.data_len;
            @memcpy(datagram.bytes[0..datagram.len], message.data_ptr[0..message.data_len]);
            target.count += 1;
            break;
        }
    }
    return .{ null, messages.len };
}

fn receive(userdata: ?*anyopaque, batch: *std.Io.Batch, _: std.Io.Timeout) std.Io.Batch.AwaitConcurrentError!void {
    assert(batch.storage.len == 1);
    assert(batch.submitted.head == std.Io.Operation.OptionalIndex.fromIndex(0));
    const operation = batch.storage[0].submission.operation.net_receive;
    const source = context(userdata).liveSocket(operation.socket_handle);
    if (source.count == 0) return error.Timeout;
    const datagram = &source.queue[source.head];
    const len = @min(datagram.len, operation.data_buffer.len);
    @memcpy(operation.data_buffer[0..len], datagram.bytes[0..len]);
    operation.message_buffer[0] = .{
        .from = datagram.from,
        .data = operation.data_buffer[0..len],
        .control = &.{},
        .flags = .{ .eor = false, .trunc = len < datagram.len, .ctrunc = false, .oob = false, .errqueue = false },
    };
    if (!operation.flags.peek) {
        source.head = (source.head + 1) % source.queue.len;
        source.count -= 1;
    }
    batch.storage[0] = .{ .completion = .{ .node = .{ .next = .none }, .result = .{ .net_receive = .{ null, 1 } } } };
    batch.submitted = .empty;
    batch.completed = .{ .head = .fromIndex(0), .tail = .fromIndex(0) };
}

fn cancel(_: ?*anyopaque, batch: *std.Io.Batch) void {
    assert(batch.pending.head == .none);
}
