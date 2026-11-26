//! Fault injection over a supplied Io provider for serialized transport tests.
const std = @import("std");
const FaultIo = @This();

comptime {
    std.debug.assert(@import("builtin").is_test);
}

base: std.Io = std.testing.io,
receive: ?Trigger = null,
send: ?Trigger = null,
send_failure: std.Io.net.Socket.SendError = error.AddressFamilyUnsupported,
clock: ?Trigger = null,
entropy: ?Trigger = null,
receive_calls: usize = 0,
send_calls: usize = 0,
clock_calls: usize = 0,
entropy_calls: usize = 0,
longest_wait_ms: i64 = 0,

pub const Trigger = struct {
    at: usize = 1,
    socket: ?std.Io.net.Socket.Handle = null,

    fn matches(self: Trigger, calls: usize, socket: ?std.Io.net.Socket.Handle) bool {
        return calls >= self.at and (self.socket == null or self.socket == socket);
    }
};

/// Keep the fixture alive and at a stable address while its Io is in use. Serialize calls
/// and changes to the fault settings; fixtures do not share state.
pub fn io(self: *FaultIo) std.Io {
    return .{ .userdata = self, .vtable = &vtable };
}

fn context(userdata: ?*anyopaque) *FaultIo {
    return @ptrCast(@alignCast(userdata.?));
}

fn receiveHook(userdata: ?*anyopaque, batch: *std.Io.Batch, timeout: std.Io.Timeout) std.Io.Batch.AwaitConcurrentError!void {
    const self = context(userdata);
    if (batch.submitted.head != .none) {
        const operation = batch.storage[batch.submitted.head.toIndex()].submission.operation;
        if (operation == .net_receive) {
            self.receive_calls += 1;
            if (timeout == .duration) self.longest_wait_ms = @max(self.longest_wait_ms, timeout.duration.raw.toMilliseconds());
            if (self.receive) |trigger| if (trigger.matches(self.receive_calls, operation.net_receive.socket_handle)) return error.Canceled;
        }
    }
    return self.base.vtable.batchAwaitConcurrent(self.base.userdata, batch, timeout);
}

fn sendHook(userdata: ?*anyopaque, socket: std.Io.net.Socket.Handle, messages: []std.Io.net.OutgoingMessage, flags: std.Io.net.SendFlags) struct { ?std.Io.net.Socket.SendError, usize } {
    const self = context(userdata);
    self.send_calls += 1;
    if (self.send) |trigger| if (trigger.matches(self.send_calls, socket)) return .{ self.send_failure, 0 };
    return self.base.vtable.netSend(self.base.userdata, socket, messages, flags);
}

fn clockHook(userdata: ?*anyopaque, clock: std.Io.Clock) std.Io.Timestamp {
    const self = context(userdata);
    self.clock_calls += 1;
    if (self.clock) |trigger| if (trigger.matches(self.clock_calls, null)) return .{ .nanoseconds = -1 };
    return self.base.vtable.now(self.base.userdata, clock);
}

fn entropyHook(userdata: ?*anyopaque, bytes: []u8) std.Io.RandomSecureError!void {
    const self = context(userdata);
    self.entropy_calls += 1;
    if (self.entropy) |trigger| if (trigger.matches(self.entropy_calls, null)) return error.EntropyUnavailable;
    return self.base.vtable.randomSecure(self.base.userdata, bytes);
}

const vtable: std.Io.VTable = blk: {
    var result: std.Io.VTable = undefined;
    for (std.meta.fields(std.Io.VTable)) |field| {
        @field(result, field.name) = forward(field.name);
    }
    result.batchAwaitConcurrent = receiveHook;
    result.netSend = sendHook;
    result.now = clockHook;
    result.randomSecure = entropyHook;
    break :blk result;
};

// Every delegated operation must receive the base provider's userdata, not this fixture.
fn forward(comptime name: []const u8) @FieldType(std.Io.VTable, name) {
    const Pointer = @FieldType(std.Io.VTable, name);
    const Function = @typeInfo(Pointer).pointer.child;
    const info = @typeInfo(Function).@"fn";
    const Args = std.meta.ArgsTuple(Function);
    const Return = info.return_type.?;
    return switch (info.params.len) {
        1 => &struct {
            fn call(userdata: ?*anyopaque) Return {
                const base = context(userdata).base;
                return @call(.auto, @field(base.vtable, name), .{base.userdata});
            }
        }.call,
        2 => &struct {
            fn call(userdata: ?*anyopaque, a1: @FieldType(Args, "1")) Return {
                const base = context(userdata).base;
                return @call(.auto, @field(base.vtable, name), .{ base.userdata, a1 });
            }
        }.call,
        3 => &struct {
            fn call(userdata: ?*anyopaque, a1: @FieldType(Args, "1"), a2: @FieldType(Args, "2")) Return {
                const base = context(userdata).base;
                return @call(.auto, @field(base.vtable, name), .{ base.userdata, a1, a2 });
            }
        }.call,
        4 => &struct {
            fn call(userdata: ?*anyopaque, a1: @FieldType(Args, "1"), a2: @FieldType(Args, "2"), a3: @FieldType(Args, "3")) Return {
                const base = context(userdata).base;
                return @call(.auto, @field(base.vtable, name), .{ base.userdata, a1, a2, a3 });
            }
        }.call,
        5 => &struct {
            fn call(userdata: ?*anyopaque, a1: @FieldType(Args, "1"), a2: @FieldType(Args, "2"), a3: @FieldType(Args, "3"), a4: @FieldType(Args, "4")) Return {
                const base = context(userdata).base;
                return @call(.auto, @field(base.vtable, name), .{ base.userdata, a1, a2, a3, a4 });
            }
        }.call,
        6 => &struct {
            fn call(userdata: ?*anyopaque, a1: @FieldType(Args, "1"), a2: @FieldType(Args, "2"), a3: @FieldType(Args, "3"), a4: @FieldType(Args, "4"), a5: @FieldType(Args, "5")) Return {
                const base = context(userdata).base;
                return @call(.auto, @field(base.vtable, name), .{ base.userdata, a1, a2, a3, a4, a5 });
            }
        }.call,
        7 => &struct {
            fn call(userdata: ?*anyopaque, a1: @FieldType(Args, "1"), a2: @FieldType(Args, "2"), a3: @FieldType(Args, "3"), a4: @FieldType(Args, "4"), a5: @FieldType(Args, "5"), a6: @FieldType(Args, "6")) Return {
                const base = context(userdata).base;
                return @call(.auto, @field(base.vtable, name), .{ base.userdata, a1, a2, a3, a4, a5, a6 });
            }
        }.call,
        8 => &struct {
            fn call(userdata: ?*anyopaque, a1: @FieldType(Args, "1"), a2: @FieldType(Args, "2"), a3: @FieldType(Args, "3"), a4: @FieldType(Args, "4"), a5: @FieldType(Args, "5"), a6: @FieldType(Args, "6"), a7: @FieldType(Args, "7")) Return {
                const base = context(userdata).base;
                return @call(.auto, @field(base.vtable, name), .{ base.userdata, a1, a2, a3, a4, a5, a6, a7 });
            }
        }.call,
        else => @compileError("unsupported Io vtable arity"),
    };
}

test {
    _ = @import("fault_io_test.zig");
}
