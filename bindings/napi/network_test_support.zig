const std = @import("std");
const napi = @import("zapi:zapi").napi;
const n = @import("network");

pub const topic_policy = blk: {
    var boundary: n.gossipsub.topic_policy.Boundary = .{ .digest = @splat(0) };
    boundary.rules[@intFromEnum(n.gossipsub.topic.Kind.beacon_block)] = .{ .count = 1, .ssz_max = 100 };
    break :blk [_]n.gossipsub.topic_policy.Boundary{boundary};
};

/// The test executable links no Node runtime, so a notification only counts here, and returns `status`.
pub var notifications = std.atomic.Value(u32).init(0);
pub var status: c_uint = 0;
fn napiCallThreadsafeFunction(_: ?*anyopaque, _: ?*anyopaque, _: c_uint) callconv(.c) c_uint {
    _ = notifications.fetchAdd(1, .acq_rel);
    return status;
}
/// Whether an exception is pending, which clearing the last exception resets.
pub var exception_pending = false;
fn napiIsExceptionPending(_: ?*anyopaque, result: *bool) callconv(.c) c_uint {
    result.* = exception_pending;
    return 0;
}
fn napiGetAndClearLastException(_: ?*anyopaque, result: *?*anyopaque) callconv(.c) c_uint {
    exception_pending = false;
    result.* = null;
    return 0;
}
/// The status `napi_get_undefined` returns, as Node's does once JavaScript can no longer run.
pub var undefined_status: c_uint = 0;
fn napiGetUndefined(_: ?*anyopaque, result: *?*anyopaque) callconv(.c) c_uint {
    result.* = null;
    return undefined_status;
}
pub var references_deleted: usize = 0;
fn napiDeleteReference(_: ?*anyopaque, ref: ?*anyopaque) callconv(.c) c_uint {
    std.debug.assert(ref != null);
    references_deleted += 1;
    return 0;
}
/// N-API calls the tests link but never reach: no cleanup hook is live, and a notification
/// fails before calling its callback.
fn napiUnreached() callconv(.c) c_uint {
    return napi.c.napi_generic_failure;
}
comptime {
    @export(&napiCallThreadsafeFunction, .{ .name = "napi_call_threadsafe_function" });
    @export(&napiIsExceptionPending, .{ .name = "napi_is_exception_pending" });
    @export(&napiGetAndClearLastException, .{ .name = "napi_get_and_clear_last_exception" });
    @export(&napiGetUndefined, .{ .name = "napi_get_undefined" });
    @export(&napiDeleteReference, .{ .name = "napi_delete_reference" });
    for (.{ "napi_remove_env_cleanup_hook", "napi_call_function" }) |name| @export(&napiUnreached, .{ .name = name });
}

/// Runs `run` in a child process, which must abort after printing `expected` to stderr.
pub fn expectFatal(comptime run: fn () void, expected: []const u8) !void {
    var fds: [2]std.c.fd_t = undefined;
    try std.testing.expectEqual(@as(c_int, 0), std.c.pipe(&fds));
    const pid = std.c.fork();
    try std.testing.expect(pid >= 0);
    if (pid == 0) {
        _ = std.c.dup2(fds[1], 2);
        run();
        std.c._exit(3);
    }
    _ = std.c.close(fds[1]);
    var output: [512]u8 = undefined;
    var len: usize = 0;
    for (0..output.len) |_| {
        const read = std.c.read(fds[0], output[len..].ptr, output.len - len);
        if (read <= 0) break;
        len += @intCast(read);
    }
    _ = std.c.close(fds[0]);
    var wait_status: c_int = 0;
    try std.testing.expectEqual(pid, std.c.waitpid(pid, &wait_status, 0));
    const code: u32 = @bitCast(wait_status);
    try std.testing.expect(std.c.W.IFSIGNALED(code));
    try std.testing.expectEqual(std.c.SIG.ABRT, std.c.W.TERMSIG(code));
    try std.testing.expect(std.mem.find(u8, output[0..len], expected) != null);
}
