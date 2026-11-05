const std = @import("std");

pub const Seccomp = struct {
    pub const Instruction = extern struct { code: u16, jt: u8, jf: u8, k: u32 };
    const Program = extern struct { len: c_ushort, filter: [*]const Instruction };
    const instructions_max = 21;
    const Stage = enum { no_new_privs, capability, filter };
    const Failure = struct { stage: Stage, errno: std.os.linux.E };

    pub const Installation = union(enum) {
        installed,
        unavailable: Failure,
        failed: Failure,

        pub fn require(self: Installation) !void {
            switch (self) {
                .installed => {},
                .unavailable, .failed => |failure| {
                    std.debug.print("seccomp {s}: {s} returned {s}\n", .{ @tagName(self), @tagName(failure.stage), @tagName(failure.errno) });
                    return if (self == .unavailable) error.SkipZigTest else error.SeccompSetupFailed;
                },
            }
        }
    };

    /// Installs only on the calling disposable thread. Do not start threads or Io tasks afterward:
    /// they inherit the filter. A known-good probe distinguishes missing capability from bad filters.
    pub fn install(filter: []const Instruction) Installation {
        const linux = std.os.linux;
        std.debug.assert(filter.len > 0 and filter.len <= instructions_max);
        const privileges = linux.errno(linux.prctl(@intFromEnum(linux.PR.SET_NO_NEW_PRIVS), 1, 0, 0, 0));
        if (privileges != .SUCCESS) return capabilityFailure(.no_new_privs, privileges);
        const probe: [1]Instruction = .{.{ .code = linux.BPF.RET | linux.BPF.K, .jt = 0, .jf = 0, .k = linux.SECCOMP.RET.ALLOW }};
        const capability = installProgram(&probe);
        if (capability != .SUCCESS) return capabilityFailure(.capability, capability);
        const errno = installProgram(filter);
        if (errno != .SUCCESS) return .{ .failed = .{ .stage = .filter, .errno = errno } };
        return .installed;
    }

    fn installProgram(filter: []const Instruction) std.os.linux.E {
        const linux = std.os.linux;
        const program: Program = .{ .len = @intCast(filter.len), .filter = filter.ptr };
        return linux.errno(linux.seccomp(linux.SECCOMP.SET_MODE_FILTER, 0, &program));
    }

    fn capabilityFailure(stage: Stage, errno: std.os.linux.E) Installation {
        const failure: Failure = .{ .stage = stage, .errno = errno };
        return switch (errno) {
            .ACCES, .PERM, .INVAL, .NOSYS, .OPNOTSUPP => .{ .unavailable = failure },
            else => .{ .failed = failure },
        };
    }
};

/// A seccomp filter that fails sendto and sendmmsg on chosen sockets with a real errno.
pub const SendFilter = struct {
    pub const Rule = struct {
        socket: std.Io.net.Socket.Handle,
        errno: std.os.linux.E,
        /// Fails only sends that ask not to wait, as a full send buffer does.
        nonblocking_only: bool = false,
    };

    const rules_max = 4;

    /// Filters the calling thread's sends until the thread ends, one rule per socket. Threads it
    /// starts afterwards inherit the filter, so the caller must not start any, including Io tasks.
    pub fn install(rules: []const Rule) Seccomp.Installation {
        const linux = std.os.linux;
        const bpf = linux.BPF;
        std.debug.assert(rules.len > 0 and rules.len <= rules_max);
        const little = comptime @import("builtin").cpu.arch.endian() == .little;
        const descriptor: u32 = @offsetOf(linux.SECCOMP.data, "arg0") + if (little) 0 else 4;
        const flags: u32 = @offsetOf(linux.SECCOMP.data, "arg3") + if (little) 0 else 4;
        var length: usize = 5;
        for (rules) |rule| length += if (rule.nonblocking_only) 4 else 2;
        const allow = length - 1;
        var filter: [5 + 4 * rules_max]Seccomp.Instruction = undefined;
        filter[0] = .{ .code = bpf.LD | bpf.W | bpf.ABS, .jt = 0, .jf = 0, .k = @offsetOf(linux.SECCOMP.data, "nr") };
        filter[1] = .{ .code = bpf.JMP | bpf.JEQ | bpf.K, .jt = 1, .jf = 0, .k = @intFromEnum(linux.SYS.sendto) };
        filter[2] = .{ .code = bpf.JMP | bpf.JEQ | bpf.K, .jt = 0, .jf = @intCast(allow - 3), .k = @intFromEnum(linux.SYS.sendmmsg) };
        filter[3] = .{ .code = bpf.LD | bpf.W | bpf.ABS, .jt = 0, .jf = 0, .k = descriptor };
        var at: usize = 4;
        for (rules) |rule| {
            const block: u8 = if (rule.nonblocking_only) 4 else 2;
            filter[at] = .{ .code = bpf.JMP | bpf.JEQ | bpf.K, .jt = 0, .jf = block - 1, .k = @intCast(rule.socket) };
            if (rule.nonblocking_only) {
                filter[at + 1] = .{ .code = bpf.LD | bpf.W | bpf.ABS, .jt = 0, .jf = 0, .k = flags };
                filter[at + 2] = .{ .code = bpf.JMP | bpf.JSET | bpf.K, .jt = 0, .jf = @intCast(allow - at - 3), .k = linux.MSG.DONTWAIT };
            }
            filter[at + block - 1] = .{ .code = bpf.RET | bpf.K, .jt = 0, .jf = 0, .k = linux.SECCOMP.RET.ERRNO | @as(u32, @intFromEnum(rule.errno)) };
            at += block;
        }
        std.debug.assert(at == allow);
        filter[allow] = .{ .code = bpf.RET | bpf.K, .jt = 0, .jf = 0, .k = linux.SECCOMP.RET.ALLOW };
        return Seccomp.install(filter[0..length]);
    }
};

test {
    _ = @import("linux_test_support_test.zig");
}
