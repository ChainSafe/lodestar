const std = @import("std");
const udp = @import("root.zig");
const testing = @import("linux_test_support.zig");
const Seccomp = testing.Seccomp;

test "UDP seccomp distinguishes unavailable capability from a malformed filter" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    const Worker = struct {
        denied: bool,
        installation: Seccomp.Installation = undefined,
        result: Seccomp.Installation = undefined,

        fn run(self: *@This()) void {
            const linux = std.os.linux;
            const bpf = linux.BPF;
            const allow = [_]Seccomp.Instruction{
                .{ .code = bpf.RET | bpf.K, .jt = 0, .jf = 0, .k = linux.SECCOMP.RET.ALLOW },
            };
            const deny = [_]Seccomp.Instruction{
                .{ .code = bpf.LD | bpf.W | bpf.ABS, .jt = 0, .jf = 0, .k = @offsetOf(linux.SECCOMP.data, "nr") },
                .{ .code = bpf.JMP | bpf.JEQ | bpf.K, .jt = 0, .jf = 1, .k = @intFromEnum(linux.SYS.seccomp) },
                .{ .code = bpf.RET | bpf.K, .jt = 0, .jf = 0, .k = linux.SECCOMP.RET.ERRNO | @as(u32, @intFromEnum(linux.E.ACCES)) },
                allow[0],
            };
            self.installation = Seccomp.install(if (self.denied) &deny else &allow);
            if (self.installation != .installed) return;
            self.result = Seccomp.install(if (self.denied) &allow else deny[0..1]);
        }
    };
    for ([_]bool{ false, true }) |denied| {
        var worker: Worker = .{ .denied = denied };
        const thread = try std.Thread.spawn(.{}, Worker.run, .{&worker});
        thread.join();
        try worker.installation.require();
        if (denied) {
            try std.testing.expect(worker.result == .unavailable);
            try std.testing.expectEqual(.capability, worker.result.unavailable.stage);
            try std.testing.expectEqual(.ACCES, worker.result.unavailable.errno);
            try std.testing.expectError(error.SkipZigTest, worker.result.require());
        } else {
            try std.testing.expect(worker.result == .failed);
            try std.testing.expectEqual(.filter, worker.result.failed.stage);
            try std.testing.expectEqual(.INVAL, worker.result.failed.errno);
            try std.testing.expectError(error.SeccompSetupFailed, worker.result.require());
        }
    }
}

test "UDP send filter selects descriptor and flags and ends with its thread" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var selected = try udp.Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer selected.close(std.testing.io);
    var other = try udp.Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer other.close(std.testing.io);
    const Worker = struct {
        installation: Seccomp.Installation = undefined,
        result: anyerror!void = {},

        fn run(self: *@This(), filtered: *const udp.Sockets, unfiltered: *const udp.Sockets) void {
            self.installation = testing.SendFilter.install(&.{.{ .socket = filtered.primary().handle, .errno = .ACCES, .nonblocking_only = true }});
            if (self.installation != .installed) return;
            self.result = send(filtered, unfiltered);
        }

        fn send(filtered: *const udp.Sockets, unfiltered: *const udp.Sockets) !void {
            try std.testing.expectError(error.AccessDenied, filtered.sendTo(std.testing.io, filtered.localAddress(), "denied", 16));
            try unfiltered.sendTo(std.testing.io, unfiltered.localAddress(), "other", 16);
            try filtered.primary().send(std.testing.io, &filtered.primary().address, "blocking");
        }
    };
    var worker: Worker = .{};
    const thread = try std.Thread.spawn(.{}, Worker.run, .{ &worker, &selected, &other });
    thread.join();
    try worker.installation.require();
    try worker.result;
    try selected.sendTo(std.testing.io, selected.localAddress(), "parent", 16);
    var buffer: [16]u8 = undefined;
    const timeout: std.Io.Timeout = .{ .duration = .{ .raw = .fromMilliseconds(1_000), .clock = .awake } };
    for ([_][]const u8{ "blocking", "parent" }) |expected| {
        try std.testing.expectEqualStrings(expected, (try selected.receiveDatagram(std.testing.io, &buffer, timeout)).bytes);
    }
    try std.testing.expectEqualStrings("other", (try other.receiveDatagram(std.testing.io, &buffer, timeout)).bytes);
    var ready: [2]bool = @splat(true);
    try std.testing.expectEqual(null, try selected.receiveReady(std.testing.io, &buffer, &ready));
}
