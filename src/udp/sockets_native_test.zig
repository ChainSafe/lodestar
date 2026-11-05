const std = @import("std");
const Sockets = @import("sockets.zig").Sockets;
const Address = @import("address.zig").Address;
const native = @import("linux_test_support.zig");
const net = std.Io.net;

const loopbacks: Sockets.Bindings = .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } };
const payload_max = 1_280;

fn timeout(milliseconds: i64) std.Io.Timeout {
    return .{ .duration = .{ .raw = .fromMilliseconds(milliseconds), .clock = .awake } };
}

fn oneSecond() std.Io.Timeout {
    return timeout(1_000);
}

fn readAny(sockets: *Sockets, io: std.Io, buffer: []u8) Sockets.ReceiveError!?net.IncomingMessage {
    var ready: [2]bool = @splat(true);
    return sockets.receiveReady(io, buffer, &ready);
}

fn sendMany(sockets: *const Sockets, io: std.Io, messages: []const Sockets.Outgoing) Sockets.SendOutcome {
    var scratch: Sockets.BatchScratch = undefined;
    return sockets.sendMany(io, messages, 1500, &scratch);
}

test "UDP distinguishes destination refusal from access denial for native single and batch sends" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var sockets: [2]Sockets = undefined;
    for (&sockets, 0..) |*socket, index| {
        errdefer for (sockets[0..index]) |*bound| bound.close(std.testing.io);
        socket.* = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    }
    defer for (&sockets) |*socket| socket.close(std.testing.io);
    var outcome: Refusal = .{};
    const thread = try std.Thread.spawn(.{}, Refusal.run, .{ &outcome, &sockets });
    thread.join();
    try outcome.installation.require();
    try std.testing.expectError(error.DestinationRefused, outcome.results[0]);
    try std.testing.expectError(error.AccessDenied, outcome.results[1]);
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 0, .failure = error.DestinationRefused }, outcome.batches[0]);
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 0, .failure = error.AccessDenied }, outcome.batches[1]);
    var buffer: [16]u8 = undefined;
    try std.testing.expectEqual(null, try readAny(&sockets[0], std.testing.io, &buffer));
}

const Refusal = struct {
    installation: native.Seccomp.Installation = undefined,
    results: [2]Sockets.SendError!void = @splat({}),
    batches: [2]Sockets.SendOutcome = undefined,

    fn run(self: *Refusal, sockets: *const [2]Sockets) void {
        const errnos = [_]std.os.linux.E{ .PERM, .ACCES };
        var rules: [2]native.SendFilter.Rule = undefined;
        for (&rules, sockets, errnos) |*rule, socket, errno| {
            rule.* = .{ .socket = socket.primary().handle, .errno = errno };
        }
        self.installation = native.SendFilter.install(&rules);
        if (self.installation != .installed) return;
        const destination = sockets[0].primary().address;
        for (sockets, &self.results, &self.batches) |*socket, *result, *batch| {
            result.* = socket.sendTo(std.testing.io, Address.fromNetwork(destination), "filtered", 16);
            const message: Sockets.Outgoing = .{ .to = Address.fromNetwork(destination), .bytes = "filtered" };
            batch.* = sendMany(socket, std.testing.io, (&message)[0..1]);
        }
    }
};

test "UDP native pressure returns without polling writable for EAGAIN ENOBUFS and ENOMEM" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var sockets = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer sockets.close(std.testing.io);
    for ([_]std.os.linux.E{ .AGAIN, .NOBUFS, .NOMEM }) |errno| {
        var pressure: Pressure = .{ .errno = errno };
        const thread = try std.Thread.spawn(.{}, Pressure.run, .{ &pressure, &sockets });
        thread.join();
        try pressure.installation.require();
        try std.testing.expectEqual(@as(usize, 0), Pressure.waits);
        const expected: Sockets.SendError = if (errno == .AGAIN) error.WouldBlock else error.SystemResources;
        try std.testing.expectError(expected, pressure.single);
        try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 0, .failure = expected }, pressure.batch);
    }
    var buffer: [16]u8 = undefined;
    try std.testing.expectEqual(null, try readAny(&sockets, std.testing.io, &buffer));
}

const Pressure = struct {
    errno: std.os.linux.E,
    installation: native.Seccomp.Installation = undefined,
    single: Sockets.SendError!void = {},
    batch: Sockets.SendOutcome = undefined,
    var waits: usize = 0;

    fn run(self: *Pressure, sockets: *const Sockets) void {
        self.installation = native.SendFilter.install(&.{.{ .socket = sockets.primary().handle, .errno = self.errno, .nonblocking_only = true }});
        if (self.installation != .installed) return;
        waits = 0;
        var vtable = std.testing.io.vtable.*;
        vtable.batchAwaitConcurrent = wait;
        const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
        const destination = sockets.primary().address;
        self.single = sockets.sendTo(io, Address.fromNetwork(destination), "dropped", 16);
        const message: Sockets.Outgoing = .{ .to = Address.fromNetwork(destination), .bytes = "dropped" };
        self.batch = sendMany(sockets, io, (&message)[0..1]);
    }

    fn wait(_: ?*anyopaque, _: *std.Io.Batch, _: std.Io.Timeout) std.Io.Batch.AwaitConcurrentError!void {
        waits += 1;
        return error.Canceled;
    }
};

test "UDP native ready reads cost one receive each, never poll and never read an unmarked family" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var sockets = try Sockets.bind(std.testing.io, loopbacks);
    defer sockets.close(std.testing.io);
    var single = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer single.close(std.testing.io);
    const ip4 = sockets.values[0].?;
    for ([_][]const u8{ "first", "second", "third" }) |payload| try ip4.send(std.testing.io, &ip4.address, payload);
    try sockets.values[1].?.send(std.testing.io, &sockets.values[1].?.address, "unmarked");
    var outcome: NoPoll = .{};
    const thread = try std.Thread.spawn(.{}, NoPoll.run, .{ &outcome, &sockets, &single });
    thread.join();
    try outcome.installation.require();
    // The filter refuses every poll, which Threaded reports as ConcurrencyUnavailable, and every
    // read of the IPv6 socket.
    try std.testing.expectError(error.ConcurrencyUnavailable, outcome.polled);
    try std.testing.expectError(error.NetworkDown, outcome.unmarked);
    try outcome.drained;
    try std.testing.expectEqual(@as(usize, 3), outcome.received);
    try std.testing.expectEqual(@as(usize, 4), outcome.reads);
    try std.testing.expectEqual([2]bool{ false, false }, outcome.ready);
    try std.testing.expectError(error.Timeout, outcome.timed);
}

/// Filters one thread through seccomp: every poll and ppoll fails with EPERM, and every recvmsg
/// on the IPv6 socket with ENETDOWN. Counts native reads through the cancellation check each one
/// makes. The filter ends with the thread.
const NoPoll = struct {
    installation: native.Seccomp.Installation = undefined,
    drained: Sockets.ReceiveError!void = {},
    received: usize = 0,
    reads: usize = 0,
    ready: [2]bool = @splat(true),
    timed: Sockets.ReceiveError!void = {},
    polled: Sockets.ReceiveError!void = {},
    unmarked: Sockets.ReceiveError!void = {},

    threadlocal var checks: usize = 0;

    fn check(userdata: ?*anyopaque) std.Io.Cancelable!void {
        checks += 1;
        return std.testing.io.vtable.checkCancel(userdata);
    }

    fn run(self: *NoPoll, sockets: *Sockets, single: *Sockets) void {
        const linux = std.os.linux;
        const bpf = linux.BPF;
        const little = comptime @import("builtin").cpu.arch.endian() == .little;
        const descriptor: u32 = @offsetOf(linux.SECCOMP.data, "arg0") + if (little) 0 else 4;
        const poll: u32 = if (@hasField(linux.SYS, "poll")) @intFromEnum(linux.SYS.poll) else @intFromEnum(linux.SYS.ppoll);
        const filter = [_]native.Seccomp.Instruction{
            .{ .code = bpf.LD | bpf.W | bpf.ABS, .jt = 0, .jf = 0, .k = @offsetOf(linux.SECCOMP.data, "nr") },
            .{ .code = bpf.JMP | bpf.JEQ | bpf.K, .jt = 0, .jf = 3, .k = @intFromEnum(linux.SYS.recvmsg) },
            .{ .code = bpf.LD | bpf.W | bpf.ABS, .jt = 0, .jf = 0, .k = descriptor },
            .{ .code = bpf.JMP | bpf.JEQ | bpf.K, .jt = 0, .jf = 4, .k = @intCast(sockets.values[1].?.handle) },
            .{ .code = bpf.RET | bpf.K, .jt = 0, .jf = 0, .k = linux.SECCOMP.RET.ERRNO | @as(u32, @intFromEnum(linux.E.NETDOWN)) },
            .{ .code = bpf.JMP | bpf.JEQ | bpf.K, .jt = 1, .jf = 0, .k = poll },
            .{ .code = bpf.JMP | bpf.JEQ | bpf.K, .jt = 0, .jf = 1, .k = @intFromEnum(linux.SYS.ppoll) },
            .{ .code = bpf.RET | bpf.K, .jt = 0, .jf = 0, .k = linux.SECCOMP.RET.ERRNO | @as(u32, @intFromEnum(linux.E.PERM)) },
            .{ .code = bpf.RET | bpf.K, .jt = 0, .jf = 0, .k = linux.SECCOMP.RET.ALLOW },
        };
        self.installation = native.Seccomp.install(&filter);
        if (self.installation != .installed) return;
        var vtable = std.testing.io.vtable.*;
        vtable.checkCancel = check;
        const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
        var buffer: [16]u8 = undefined;
        self.ready = .{ true, false };
        checks = 0;
        for (0..8) |_| {
            _ = (sockets.receiveReady(io, &buffer, &self.ready) catch |err| {
                self.drained = err;
                break;
            }) orelse break;
            self.received += 1;
        }
        self.reads = checks;
        if (single.receiveTimeout(io, &buffer, timeout(0))) |_| {} else |err| self.timed = err;
        const zero: std.Io.Timeout = .{ .duration = .{ .raw = .zero, .clock = .awake } };
        if (single.primary().receiveTimeout(std.testing.io, &buffer, zero)) |_| {} else |err| self.polled = err;
        var ip6_only: [2]bool = .{ false, true };
        if (sockets.receiveReady(io, &buffer, &ip6_only)) |_| {} else |err| self.unmarked = err;
    }
};

test "UDP native batch preserves its successful prefix when the next call reports pressure" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var sockets = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer sockets.close(std.testing.io);
    const Partial = struct {
        installation: native.Seccomp.Installation = undefined,
        outcome: Sockets.SendOutcome = undefined,
        fn run(self: *@This(), sender: *const Sockets) void {
            const linux = std.os.linux;
            const bpf = linux.BPF;
            const word: u32 = if (comptime @import("builtin").cpu.arch.endian() == .little) 0 else 4;
            const filter = [_]native.Seccomp.Instruction{
                .{ .code = bpf.LD | bpf.W | bpf.ABS, .jt = 0, .jf = 0, .k = @offsetOf(linux.SECCOMP.data, "nr") },
                .{ .code = bpf.JMP | bpf.JEQ | bpf.K, .jt = 0, .jf = 5, .k = @intFromEnum(linux.SYS.sendmmsg) },
                .{ .code = bpf.LD | bpf.W | bpf.ABS, .jt = 0, .jf = 0, .k = @offsetOf(linux.SECCOMP.data, "arg0") + word },
                .{ .code = bpf.JMP | bpf.JEQ | bpf.K, .jt = 0, .jf = 3, .k = @intCast(sender.primary().handle) },
                .{ .code = bpf.LD | bpf.W | bpf.ABS, .jt = 0, .jf = 0, .k = @offsetOf(linux.SECCOMP.data, "arg2") + word },
                .{ .code = bpf.JMP | bpf.JEQ | bpf.K, .jt = 0, .jf = 1, .k = 1 },
                .{ .code = bpf.RET | bpf.K, .jt = 0, .jf = 0, .k = linux.SECCOMP.RET.ERRNO | @as(u32, @intFromEnum(linux.E.AGAIN)) },
                .{ .code = bpf.RET | bpf.K, .jt = 0, .jf = 0, .k = linux.SECCOMP.RET.ALLOW },
            };
            self.installation = native.Seccomp.install(&filter);
            if (self.installation != .installed) return;
            const destination = sender.primary().address;
            const broadcast: net.IpAddress = .{ .ip4 = .{ .bytes = @splat(255), .port = destination.ip4.port } };
            // The first call sends a segmented group before broadcast refusal. Its successful prefix
            // hides that errno; the next call sees the injected EAGAIN on its own unsent suffix.
            const messages = [_]Sockets.Outgoing{
                .{ .to = Address.fromNetwork(destination), .bytes = "first!" },
                .{ .to = Address.fromNetwork(destination), .bytes = "second" },
                .{ .to = Address.fromNetwork(destination), .bytes = "third!" },
                .{ .to = Address.fromNetwork(broadcast), .bytes = "suffix" },
            };
            self.outcome = sendMany(sender, std.testing.io, &messages);
        }
    };
    var partial: Partial = .{};
    const thread = try std.Thread.spawn(.{}, Partial.run, .{ &partial, &sockets });
    thread.join();
    try partial.installation.require();
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 3, .failure = error.WouldBlock }, partial.outcome);
    var buffer: [16]u8 = undefined;
    for ([_][]const u8{ "first!", "second", "third!" }) |expected|
        try std.testing.expectEqualStrings(expected, (try readAny(&sockets, std.testing.io, &buffer)).?.data);
    try std.testing.expectEqual(null, try readAny(&sockets, std.testing.io, &buffer));
}

test "dual-stack UDP stops at pressure without sending or retaining later families" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var buffer: [payload_max]u8 = undefined;
    var target = try Sockets.bind(std.testing.io, .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } });
    defer target.close(std.testing.io);
    // IPv6 pressure must stop the batch before its later IPv4 entry.
    const Refused = struct {
        installation: native.Seccomp.Installation = undefined,
        outcomes: [2]Sockets.SendOutcome = undefined,

        var socket: std.Io.net.Socket.Handle = -1;
        var waits: usize = 0;

        fn run(self: *@This(), sockets: *Sockets) void {
            const filter = native.SendFilter;
            socket = sockets.values[1].?.handle;
            self.installation = filter.install(&.{.{ .socket = socket, .errno = .AGAIN, .nonblocking_only = true }});
            if (self.installation != .installed) return;
            var vtable = std.testing.io.vtable.*;
            vtable.batchAwaitConcurrent = wait;
            const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
            const local = sockets.localAddresses();
            var payload = [_]u8{ 1, 2, 3 };
            const batch = [_]Sockets.Outgoing{
                .{ .to = local[0].?, .bytes = payload[0..1] },
                .{ .to = local[1].?, .bytes = payload[1..2] },
                .{ .to = local[0].?, .bytes = payload[2..3] },
            };
            var scratch2: Sockets.BatchScratch = undefined;
            self.outcomes[0] = sockets.sendMany(io, &batch, payload_max, &scratch2);
            var fresh: [1]u8 = .{4};
            var scratch3: Sockets.BatchScratch = undefined;
            self.outcomes[1] = sockets.sendMany(io, &.{.{ .to = local[0].?, .bytes = &fresh }}, payload_max, &scratch3);
        }

        fn wait(_: ?*anyopaque, _: *std.Io.Batch, _: std.Io.Timeout) std.Io.Batch.AwaitConcurrentError!void {
            waits += 1;
            return error.Canceled;
        }
    };
    Refused.waits = 0;
    var refused: Refused = .{};
    const thread = try std.Thread.spawn(.{}, Refused.run, .{ &refused, &target });
    thread.join();
    try refused.installation.require();
    try std.testing.expectEqual(@as(usize, 0), Refused.waits);
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 1, .failure = error.WouldBlock }, refused.outcomes[0]);
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 1, .failure = null }, refused.outcomes[1]);
    var ready: [2]bool = @splat(true);
    for ([_]u8{ 1, 4 }) |expected| {
        const message = (try target.receiveReadyDatagram(std.testing.io, &buffer, &ready)).?;
        try std.testing.expectEqualSlices(u8, &.{expected}, message.bytes);
        try std.testing.expect(message.from == .ip4);
    }
    try std.testing.expectEqual(null, try target.receiveReadyDatagram(std.testing.io, &buffer, &ready));
}

test "UDP GSO segments separate buffers and preserves short and empty datagrams" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var target = try Sockets.bind(std.testing.io, loopbacks);
    defer target.close(std.testing.io);
    var scratch: Sockets.BatchScratch = undefined;
    var buffers: [Sockets.BatchScratch.capacity][1_200]u8 = undefined;
    var messages: [Sockets.BatchScratch.capacity]Sockets.Outgoing = undefined;
    for (target.localAddresses()) |address| {
        for (&messages, &buffers, 0..) |*message, *buffer, i| {
            @memset(buffer, @intCast(i));
            message.* = .{ .to = address.?, .bytes = if (i == buffers.len - 1) buffer[0..19] else buffer };
        }
        const sent = target.sendMany(std.testing.io, &messages, 1_200, &scratch);
        try std.testing.expectEqual(Sockets.SendOutcome{ .sent = messages.len, .failure = null }, sent);
        // One kernel message proves segmentation was used, not just the plain-send fallback.
        try std.testing.expectEqual(messages.len, scratch.native.headers[0].hdr.iovlen);
        var received: [1_200]u8 = undefined;
        for (messages) |message| {
            const packet = (try readAny(&target, std.testing.io, &received)).?;
            try std.testing.expectEqualSlices(u8, message.bytes, packet.data);
            try std.testing.expect(Address.fromNetwork(packet.from).eql(address.?));
        }
        try std.testing.expectEqual(null, try readAny(&target, std.testing.io, &received));
        const sizes = [_]usize{ 8, 8, 3, 8, 0, 8, 8 };
        for (messages[0..sizes.len], sizes, 0..) |*message, size, i| message.bytes = buffers[i][0..size];
        try std.testing.expectEqual(Sockets.SendOutcome{ .sent = sizes.len, .failure = null }, target.sendMany(std.testing.io, messages[0..sizes.len], 1_200, &scratch));
        for (messages[0..sizes.len]) |message|
            try std.testing.expectEqualSlices(u8, message.bytes, (try readAny(&target, std.testing.io, &received)).?.data);
        try std.testing.expectEqual(null, try readAny(&target, std.testing.io, &received));
    }
}

test "UDP GSO fallback preserves an accepted prefix and the original destination failure" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var target = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer target.close(std.testing.io);
    for ([_]std.os.linux.E{ .INVAL, .IO, .MSGSIZE, .NOPROTOOPT, .OPNOTSUPP }) |errno| {
        for ([_]bool{ false, true }) |prefix| {
            var fallback: GsoFallback = .{ .errno = errno, .prefix = prefix };
            const thread = try std.Thread.spawn(.{}, GsoFallback.run, .{ &fallback, &target });
            thread.join();
            try fallback.installation.require();
            try std.testing.expectEqual(Sockets.SendOutcome{
                .sent = if (prefix) 2 else 3,
                .failure = if (prefix) error.DestinationRefused else null,
            }, fallback.outcome);
            var buffer: [16]u8 = undefined;
            for (0..fallback.outcome.sent) |_| try std.testing.expectEqualStrings("packet", (try readAny(&target, std.testing.io, &buffer)).?.data);
            try std.testing.expectEqual(null, try readAny(&target, std.testing.io, &buffer));
        }
    }
}

const GsoFallback = struct {
    errno: std.os.linux.E,
    prefix: bool,
    installation: native.Seccomp.Installation = undefined,
    outcome: Sockets.SendOutcome = undefined,

    fn run(self: *GsoFallback, socket: *const Sockets) void {
        const linux = std.os.linux;
        const bpf = linux.BPF;
        const word: u32 = if (comptime @import("builtin").cpu.arch.endian() == .little) 0 else 4;
        // Refuse a single GSO group; the fallback's multiple individual messages remain allowed.
        const filter = [_]native.Seccomp.Instruction{
            .{ .code = bpf.LD | bpf.W | bpf.ABS, .jt = 0, .jf = 0, .k = @offsetOf(linux.SECCOMP.data, "nr") },
            .{ .code = bpf.JMP | bpf.JEQ | bpf.K, .jt = 0, .jf = 3, .k = @intFromEnum(linux.SYS.sendmmsg) },
            .{ .code = bpf.LD | bpf.W | bpf.ABS, .jt = 0, .jf = 0, .k = @offsetOf(linux.SECCOMP.data, "arg2") + word },
            .{ .code = bpf.JMP | bpf.JEQ | bpf.K, .jt = 0, .jf = 1, .k = 1 },
            .{ .code = bpf.RET | bpf.K, .jt = 0, .jf = 0, .k = linux.SECCOMP.RET.ERRNO | @as(u32, @intFromEnum(self.errno)) },
            .{ .code = bpf.RET | bpf.K, .jt = 0, .jf = 0, .k = linux.SECCOMP.RET.ALLOW },
        };
        self.installation = native.Seccomp.install(&filter);
        if (self.installation != .installed) return;
        const valid = socket.localAddress();
        var invalid = valid;
        invalid.ip4.port = 0;
        const messages = [_]Sockets.Outgoing{
            .{ .to = valid, .bytes = "packet" },
            .{ .to = valid, .bytes = "packet" },
            .{ .to = if (self.prefix) invalid else valid, .bytes = "packet" },
            .{ .to = invalid, .bytes = "packet" },
        };
        self.outcome = sendMany(socket, std.testing.io, messages[0..@as(usize, if (self.prefix) 4 else 3)]);
    }
};

test "UDP native receive batches use one syscall and cancellation leaves the next batch queued" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    const Checks = struct {
        calls: usize = 0,
        cancel: bool = false,
        fn check(context: ?*anyopaque) std.Io.Cancelable!void {
            const self: *@This() = @ptrCast(@alignCast(context.?));
            self.calls += 1;
            if (self.cancel) return error.Canceled;
        }
    };
    var target = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer target.close(std.testing.io);
    for (0..Sockets.receive_batch_max + 1) |i|
        try target.sendTo(std.testing.io, target.localAddress(), &.{@intCast(i)}, 1);
    var buffers: [Sockets.receive_batch_max][1]u8 = undefined;
    var slots: [Sockets.receive_batch_max]Sockets.ReceiveSlot = undefined;
    for (&slots, &buffers) |*slot, *buffer| slot.* = .{ .buffer = buffer };
    var scratch: Sockets.ReceiveScratch = undefined;
    var ready: [2]bool = .{ true, false };
    var checks: Checks = .{};
    var vtable = std.testing.io.vtable.*;
    vtable.checkCancel = Checks.check;
    const io: std.Io = .{ .userdata = &checks, .vtable = &vtable };
    try std.testing.expectEqual(Sockets.ReceiveOutcome{ .received = slots.len }, target.receiveManyReady(io, &slots, &ready, &scratch));
    try std.testing.expectEqual(@as(usize, 1), checks.calls);
    for (&slots, 0..) |*slot, i|
        try std.testing.expectEqualSlices(u8, &.{@intCast(i)}, (try slot.datagram()).bytes);
    checks.cancel = true;
    try std.testing.expectEqual(Sockets.ReceiveOutcome{ .failure = error.Canceled }, target.receiveManyReady(io, &slots, &ready, &scratch));
    try std.testing.expectEqual(Sockets.ReceiveOutcome{ .received = 1 }, target.receiveManyReady(std.testing.io, &slots, &ready, &scratch));
    try std.testing.expectEqualSlices(u8, &.{Sockets.receive_batch_max}, (try slots[0].datagram()).bytes);
    try std.testing.expectEqual(Sockets.ReceiveOutcome{}, target.receiveManyReady(std.testing.io, &slots, &ready, &scratch));
}
