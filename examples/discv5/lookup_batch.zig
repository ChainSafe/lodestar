//! Advances a bounded batch of caller-owned lookups through Transport, one step at a time.

const std = @import("std");
const discv5 = @import("discv5");
const CallTable = discv5.CallTable;
const Transport = discv5.Transport;
const Lookup = discv5.Lookup;

pub const operations_max: usize = CallTable.capacity_max / Lookup.parallelism;

pub const Error = Transport.Error || Lookup.Error || error{TooManyLookups};

pub const Progress = struct {
    started: u16 = 0,
    responses: u16 = 0,
    failures: u16 = 0,
};

pub const Cursor = struct {
    next: usize = 0,
};

pub const StepResult = struct {
    transport: Transport.AdvanceResult = .{},
    /// The index into `operations` of the lookup that consumed `transport.event`, if any.
    consumed: ?u16 = null,
    progress: Progress = .{},
    failure: ?Error = null,
};

/// Borrows `operations` for this call only. Pass every lookup that still has waiting calls and
/// retain the cursor across steps to rotate priority when calls contend for limited capacity.
pub fn step(
    transport: *Transport,
    io: std.Io,
    operations: []const *Lookup,
    cursor: *Cursor,
    expired_calls: []CallTable.Expired,
) Error!StepResult {
    if (expired_calls.len == 0) return error.MissingExpiryStorage;
    if (operations.len > operations_max) return error.TooManyLookups;
    var result = StepResult{};
    const first = if (operations.len == 0) 0 else cursor.next % operations.len;
    cursor.next = if (operations.len == 0) 0 else (first + 1) % operations.len;
    refill(transport, io, operations, first, &result) catch |err| {
        result.failure = err;
    };
    const cancelled = if (result.failure) |err| err == error.Canceled else false;
    result.transport = (if (cancelled) advance: {
        const now_ms = Transport.monotonicMilliseconds(io) catch |err| break :advance err;
        break :advance transport.advance(io, now_ms, expired_calls, error.Canceled);
    } else discv5.driver.step(transport, io, expired_calls, .{ .wait_max = .fromMilliseconds(25) })) catch |err| {
        result.failure = result.failure orelse err;
        return result;
    };
    consumeExpiries(transport, operations, expired_calls, &result);
    consumeEvent(transport, operations, &result) catch |err| {
        result.failure = result.failure orelse err;
    };
    result.failure = result.failure orelse if (result.transport.failure) |failure| failure.cause else null;
    if (result.failure == null) {
        refill(transport, io, operations, first, &result) catch |err| {
            result.failure = err;
        };
    }
    return result;
}

fn refill(
    transport: *Transport,
    io: std.Io,
    operations: []const *Lookup,
    first: usize,
    result: *StepResult,
) Error!void {
    for (0..Lookup.parallelism) |_| {
        var progressed = false;
        for (0..operations.len) |offset| {
            const operation = operations[(first + offset) % operations.len];
            if (operation.isFinished() or operation.waitingCount() == Lookup.parallelism) continue;
            const started = startCall(
                transport,
                io,
                operation,
                &result.progress,
            ) catch |err| switch (err) {
                error.PeerBusy, error.TableFull => continue,
                error.DestinationUnreachable => {
                    progressed = true;
                    continue;
                },
                else => return err,
            };
            if (!started) continue;
            result.progress.started += 1;
            progressed = true;
        }
        if (!progressed) return;
    }
}

fn startCall(
    transport: *Transport,
    io: std.Io,
    operation: *Lookup,
    progress: *Progress,
) Error!bool {
    const result = try transport.startLookup(io, operation, try Transport.monotonicMilliseconds(io));
    if (result.failure) |err| {
        progress.failures += 1;
        return err;
    }
    return result.started;
}

fn consumeExpiries(
    transport: *Transport,
    operations: []const *Lookup,
    expired_calls: []CallTable.Expired,
    result: *StepResult,
) void {
    var retained: usize = 0;
    expiries: for (expired_calls[0..result.transport.calls_expired]) |item| {
        for (operations) |operation| {
            if (operation.onFailure(&transport.engine, item.handle)) {
                result.progress.failures += 1;
                continue :expiries;
            }
        }
        expired_calls[retained] = item;
        retained += 1;
    }
    result.transport.calls_expired = retained;
}

fn consumeEvent(
    transport: *Transport,
    operations: []const *Lookup,
    result: *StepResult,
) Lookup.Error!void {
    for (operations, 0..) |operation, index| {
        const consumed = try operation.onEvent(&transport.engine, &result.transport.event, result.transport.now_ms);
        if (!consumed.consumed) continue;
        result.consumed = @intCast(index);
        switch (result.transport.event) {
            .response => result.progress.responses += 1,
            .failed => result.progress.failures += 1,
            else => unreachable,
        }
        return;
    }
}

comptime {
    std.debug.assert(operations_max == 85);
    std.debug.assert(operations_max * Lookup.parallelism * 2 <= std.math.maxInt(u16));
    std.debug.assert(@sizeOf(StepResult) <= @sizeOf(Transport.AdvanceResult) + 16);
}

test {
    _ = @import("lookup_batch_test.zig");
}
