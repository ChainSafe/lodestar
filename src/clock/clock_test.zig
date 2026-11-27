//! Behavioral tests for slot/epoch listeners and `waitForSlot` callers.

const std = @import("std");
const testing = std.testing;
const zio = @import("zio");
const time = @import("time");
const slot_math = @import("slot_math.zig");
const Clock = @import("Clock.zig");

const Slot = Clock.Slot;
const Epoch = Clock.Epoch;
const Error = Clock.Error;
const ListenerId = Clock.ListenerId;
const expectEqualSlices = std.testing.expectEqualSlices;

// Synchronous tests only use `now`. Waiter tests provide a real inner I/O so
// futex waits and wakes can suspend and resume normally.
const FakeClockIo = struct {
    ms: u64 = 0,
    inner: ?std.Io = null,

    fn vtableNow(userdata: ?*anyopaque, _: std.Io.Clock) std.Io.Timestamp {
        const self: *const FakeClockIo = @ptrCast(@alignCast(userdata.?));
        return std.Io.Timestamp.fromNanoseconds(@as(i96, @intCast(self.ms)) * std.time.ns_per_ms);
    }

    fn vtableFutexWaitUncancelable(userdata: ?*anyopaque, ptr: *const u32, expected: u32) void {
        const self: *const FakeClockIo = @ptrCast(@alignCast(userdata.?));
        const inner = self.inner.?;
        inner.vtable.futexWaitUncancelable(inner.userdata, ptr, expected);
    }

    fn vtableFutexWake(userdata: ?*anyopaque, ptr: *const u32, max: u32) void {
        const self: *const FakeClockIo = @ptrCast(@alignCast(userdata.?));
        const inner = self.inner.?;
        inner.vtable.futexWake(inner.userdata, ptr, max);
    }

    const vtable: std.Io.VTable = blk: {
        var vt: std.Io.VTable = undefined;
        vt.now = vtableNow;
        vt.futexWaitUncancelable = vtableFutexWaitUncancelable;
        vt.futexWake = vtableFutexWake;
        break :blk vt;
    };

    fn io(self: *const FakeClockIo) std.Io {
        return .{ .userdata = @constCast(self), .vtable = &vtable };
    }
};

const EventTraceState = struct {
    slots: [64]Slot = undefined,
    slot_len: usize = 0,
    epochs: [64]Epoch = undefined,
    epoch_len: usize = 0,

    fn onSlot(ctx: ?*anyopaque, slot: Slot) void {
        const self: *EventTraceState = @ptrCast(@alignCast(ctx.?));
        if (self.slot_len >= self.slots.len) return;
        self.slots[self.slot_len] = slot;
        self.slot_len += 1;
    }

    fn onEpoch(ctx: ?*anyopaque, epoch: Epoch) void {
        const self: *EventTraceState = @ptrCast(@alignCast(ctx.?));
        if (self.epoch_len >= self.epochs.len) return;
        self.epochs[self.epoch_len] = epoch;
        self.epoch_len += 1;
    }
};

fn rendezvousWaiters(clock: *Clock, io: std.Io, expected: usize) !void {
    var polls: usize = 0;
    while (clock.waiters.count() < expected) : (polls += 1) {
        if (polls >= 10_000) return error.RendezvousTimeout;
        std.Io.sleep(io, std.Io.Duration.fromMilliseconds(1), .awake) catch {};
    }
}

/// One ordered log fed by a slot listener and an epoch listener, so the order
/// in which the two kinds of event reach the node is observable.
const DeliveryLog = struct {
    const Tag = enum { slot, epoch };
    const Entry = struct { tag: Tag, value: u64 };

    entries: [16]Entry = undefined,
    len: usize = 0,

    fn record(self: *DeliveryLog, tag: Tag, value: u64) void {
        if (self.len >= self.entries.len) return;
        self.entries[self.len] = .{ .tag = tag, .value = value };
        self.len += 1;
    }

    fn seen(self: *const DeliveryLog) []const Entry {
        return self.entries[0..self.len];
    }

    fn onSlot(ctx: ?*anyopaque, slot: Slot) void {
        const self: *DeliveryLog = @ptrCast(@alignCast(ctx.?));
        self.record(.slot, slot);
    }

    fn onEpoch(ctx: ?*anyopaque, epoch: Epoch) void {
        const self: *DeliveryLog = @ptrCast(@alignCast(ctx.?));
        self.record(.epoch, epoch);
    }
};

const SlotTrace = struct {
    slots: [16]Slot = undefined,
    slot_len: usize = 0,

    fn onSlot(ctx: ?*anyopaque, slot: Slot) void {
        const self: *SlotTrace = @ptrCast(@alignCast(ctx.?));
        if (self.slot_len < self.slots.len) {
            self.slots[self.slot_len] = slot;
            self.slot_len += 1;
        }
    }

    fn seen(self: *const SlotTrace) []const Slot {
        return self.slots[0..self.slot_len];
    }
};

const StopAtSlotListener = struct {
    clock: *Clock,
    stop_at: Slot,
    slots: [16]Slot = undefined,
    slot_len: usize = 0,

    fn onSlot(ctx: ?*anyopaque, slot: Slot) void {
        const self: *StopAtSlotListener = @ptrCast(@alignCast(ctx.?));
        if (self.slot_len < self.slots.len) {
            self.slots[self.slot_len] = slot;
            self.slot_len += 1;
        }
        if (slot == self.stop_at) self.clock.stop();
    }

    fn seen(self: *const StopAtSlotListener) []const Slot {
        return self.slots[0..self.slot_len];
    }
};

test "init should clean up on allocation failure" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 12_000,
        .slots_per_epoch = 32,
    };
    try testing.checkAllAllocationFailures(testing.allocator, struct {
        fn run(allocator: std.mem.Allocator, config: Clock.ClockConfig) !void {
            var fake: FakeClockIo = .{ .ms = slot_math.slotStartMs(config, 0) };
            var clock: Clock = undefined;
            try clock.init(allocator, fake.io(), config);
            defer clock.deinit();
        }
    }.run, .{cfg});
}

test "every listener receives every slot, in order, exactly once" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 8,
    };
    var fake: FakeClockIo = .{ .ms = slot_math.slotStartMs(cfg, 0) };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    var first: SlotTrace = .{};
    var second: SlotTrace = .{};
    _ = try clock.onSlot(SlotTrace.onSlot, &first);
    _ = try clock.onSlot(SlotTrace.onSlot, &second);

    try testing.expectEqual(@as(?Slot, 0), clock.currentSlot());

    // Normal ticking: one slot at a time, the way the auto-loop drives it.
    for (1..4) |n| {
        fake.ms = slot_math.slotStartMs(cfg, @intCast(n));
        try testing.expectEqual(@as(?Slot, @intCast(n)), clock.currentSlot());
    }

    try expectEqualSlices(Slot, &.{ 1, 2, 3 }, first.seen());
    try expectEqualSlices(Slot, &.{ 1, 2, 3 }, second.seen());
}

test "an epoch tick lands after its boundary slot and before the next slot" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 2,
    };
    var fake: FakeClockIo = .{ .ms = slot_math.slotStartMs(cfg, 0) };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    var log: DeliveryLog = .{};
    _ = try clock.onSlot(DeliveryLog.onSlot, &log);
    _ = try clock.onEpoch(DeliveryLog.onEpoch, &log);

    // Normal ticking across the epoch-1 boundary at slot 2 (spe = 2).
    for (1..4) |n| {
        fake.ms = slot_math.slotStartMs(cfg, @intCast(n));
        try testing.expectEqual(@as(?Slot, @intCast(n)), clock.currentSlot());
    }

    const E = DeliveryLog.Entry;
    try expectEqualSlices(E, &.{
        .{ .tag = .slot, .value = 1 },
        .{ .tag = .slot, .value = 2 },
        .{ .tag = .epoch, .value = 1 },
        .{ .tag = .slot, .value = 3 },
    }, log.seen());
    try testing.expectEqual(@as(?Epoch, 1), clock.currentEpoch());
}

test "tolerance and from-slot reads do not deliver events" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 12_000,
        .slots_per_epoch = 32,
    };
    var fake: FakeClockIo = .{ .ms = slot_math.slotStartMs(cfg, 0) };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    var slots: SlotTrace = .{};
    _ = try clock.onSlot(SlotTrace.onSlot, &slots);

    // The wall advances to slot 1, but these calculations must not notify slot
    // listeners as a side effect.
    fake.ms = slot_math.slotStartMs(cfg, 1);
    try testing.expectEqual(@as(?Slot, 2), clock.slotWithFutureToleranceMs(cfg.slot_duration_ms));
    try testing.expectEqual(@as(Slot, 0), clock.slotWithPastToleranceMs(cfg.slot_duration_ms));

    fake.ms = slot_math.slotStartMs(cfg, 1) + 6_000;
    try testing.expectEqual(@as(i64, 6), clock.secFromSlot(1, null));
    try testing.expectEqual(@as(i64, 6_000), clock.msFromSlot(1, null));
    try testing.expectEqual(@as(i64, 0), clock.secFromSlot(1, slot_math.slotStartSec(cfg, 1)));
    try testing.expectEqual(@as(i64, -12), clock.secFromSlot(1, slot_math.slotStartSec(cfg, 0)));
    try testing.expectEqual(@as(i64, -12_000), clock.msFromSlot(1, slot_math.slotStartMs(cfg, 0)));

    try testing.expectEqual(@as(usize, 0), slots.slot_len);

    // An advancing read then delivers slot 1, showing that the earlier helpers
    // left event delivery untouched.
    try testing.expectEqual(@as(?Slot, 1), clock.currentSlot());
    try expectEqualSlices(Slot, &.{1}, slots.seen());
}

test "a long host suspend delivers every missed slot and crossed epoch" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 32,
    };
    var fake: FakeClockIo = .{ .ms = slot_math.slotStartMs(cfg, 0) };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    const CatchUpTrace = struct {
        last_slot: Slot = 0,
        slot_count: u64 = 0,
        epoch_count: u64 = 0,
        in_order: bool = true,

        fn onSlot(ctx: ?*anyopaque, slot: Slot) void {
            const self: *@This() = @ptrCast(@alignCast(ctx.?));
            if (slot != self.last_slot + 1) self.in_order = false;
            self.last_slot = slot;
            self.slot_count += 1;
        }

        fn onEpoch(ctx: ?*anyopaque, _: Epoch) void {
            const self: *@This() = @ptrCast(@alignCast(ctx.?));
            self.epoch_count += 1;
        }
    };
    var trace: CatchUpTrace = .{};
    _ = try clock.onSlot(CatchUpTrace.onSlot, &trace);
    _ = try clock.onEpoch(CatchUpTrace.onEpoch, &trace);

    // Catch-up must reach the wall slot, deliver every missed slot once and in
    // order, and emit each crossed epoch.
    const backlog: u64 = 32_768;
    fake.ms = slot_math.slotStartMs(cfg, backlog);
    try testing.expectEqual(@as(?Slot, backlog), clock.currentSlot());

    try testing.expect(trace.in_order);
    try testing.expectEqual(backlog, trace.slot_count);
    try testing.expectEqual(backlog / cfg.slots_per_epoch, trace.epoch_count);
}

test "top-level wall step-back never re-emits or regresses delivery" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 8,
    };
    var fake: FakeClockIo = .{ .ms = slot_math.slotStartMs(cfg, 0) };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    var slots: SlotTrace = .{};
    _ = try clock.onSlot(SlotTrace.onSlot, &slots);

    // Delivery reaches slot 3, then NTP corrects the host clock back to slot 1.
    // The returned slot follows the wall down, but the walk target is behind
    // delivery, so the step-back re-emits nothing.
    fake.ms = slot_math.slotStartMs(cfg, 3);
    try testing.expectEqual(@as(?Slot, 3), clock.currentSlot());

    fake.ms = slot_math.slotStartMs(cfg, 1);
    try testing.expectEqual(@as(?Slot, 1), clock.currentSlot());
    try expectEqualSlices(Slot, &.{ 1, 2, 3 }, slots.seen());

    // Drive on to slot 5. Only 4 and 5 are new, so the stream ends 1,2,3,4,5.
    // Had the step-back regressed delivery, this drive would resend 2 and 3.
    fake.ms = slot_math.slotStartMs(cfg, 5);
    try testing.expectEqual(@as(?Slot, 5), clock.currentSlot());
    try expectEqualSlices(Slot, &.{ 1, 2, 3, 4, 5 }, slots.seen());
}

test "first delivery from a pre-genesis start begins at slot 0" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 4,
    };
    var fake: FakeClockIo = .{ .ms = cfg.genesis_time_sec * 1000 - cfg.slot_duration_ms };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    var slots: SlotTrace = .{};
    _ = try clock.onSlot(SlotTrace.onSlot, &slots);

    // The node started before genesis, so no slot is current yet and a read
    // delivers nothing.
    try testing.expectEqual(@as(?Slot, null), clock.currentSlot());
    try testing.expectEqual(@as(?Epoch, null), clock.currentEpoch());
    try testing.expectEqual(@as(Slot, 0), clock.currentSlotOrGenesis());
    try testing.expectEqual(@as(Epoch, 0), clock.currentEpochOrGenesis());
    try testing.expectEqual(@as(usize, 0), slots.slot_len);

    // Wall slot 2: the first catch-up from a pre-genesis start opens delivery
    // at slot 0, so the backlog arrives as 0, 1, 2.
    fake.ms = slot_math.slotStartMs(cfg, 2);
    try testing.expectEqual(@as(?Slot, 2), clock.currentSlot());
    try expectEqualSlices(Slot, &.{ 0, 1, 2 }, slots.seen());
}

test "a listener can unsubscribe itself during delivery" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 4,
    };
    var fake: FakeClockIo = .{ .ms = cfg.genesis_time_sec * 1000 - cfg.slot_duration_ms };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    const SelfRemovingListener = struct {
        clock: *Clock,
        id: ListenerId = 0,
        slots: [4]Slot = undefined,
        slot_len: usize = 0,

        fn onSlot(ctx: ?*anyopaque, slot: Slot) void {
            const self: *@This() = @ptrCast(@alignCast(ctx.?));
            self.slots[self.slot_len] = slot;
            self.slot_len += 1;
            _ = self.clock.offSlot(self.id);
        }
    };
    var self_removing: SelfRemovingListener = .{ .clock = &clock };
    var remaining: SlotTrace = .{};
    self_removing.id = try clock.onSlot(SelfRemovingListener.onSlot, &self_removing);
    _ = try clock.onSlot(SlotTrace.onSlot, &remaining);

    // The listener receives the in-progress event where it removes itself, but
    // no later events. Other listeners continue normally.
    fake.ms = slot_math.slotStartMs(cfg, 0);
    _ = clock.currentSlot();
    fake.ms = slot_math.slotStartMs(cfg, 2);
    try testing.expectEqual(@as(?Slot, 2), clock.currentSlot());

    try expectEqualSlices(Slot, &.{0}, self_removing.slots[0..self_removing.slot_len]);
    try expectEqualSlices(Slot, &.{ 0, 1, 2 }, remaining.seen());
}

test "unregistered listeners receive no later events" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 4,
    };
    var fake: FakeClockIo = .{ .ms = cfg.genesis_time_sec * 1000 - cfg.slot_duration_ms };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    var trace: EventTraceState = .{};
    const slot_id = try clock.onSlot(EventTraceState.onSlot, &trace);
    const epoch_id = try clock.onEpoch(EventTraceState.onEpoch, &trace);

    // Slots 0..4 cross into epoch 1, so both listeners receive events before
    // they are removed.
    fake.ms = slot_math.slotStartMs(cfg, 4);
    try testing.expectEqual(@as(?Slot, 4), clock.currentSlot());
    try testing.expectEqual(@as(usize, 5), trace.slot_len);
    try testing.expectEqual(@as(usize, 1), trace.epoch_len);

    try testing.expect(clock.offSlot(slot_id));
    try testing.expect(clock.offEpoch(epoch_id));

    // Advancing to slot 8 crosses another epoch but must not notify either
    // removed listener.
    fake.ms = slot_math.slotStartMs(cfg, 8);
    try testing.expectEqual(@as(?Slot, 8), clock.currentSlot());
    try testing.expectEqual(@as(usize, 5), trace.slot_len);
    try testing.expectEqual(@as(usize, 1), trace.epoch_len);
}

test "stop from a listener prevents subsequent slot delivery" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 8,
    };
    var fake: FakeClockIo = .{ .ms = slot_math.slotStartMs(cfg, 0) };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    var listener: StopAtSlotListener = .{ .clock = &clock, .stop_at = 1 };
    _ = try clock.onSlot(StopAtSlotListener.onSlot, &listener);

    // Slots 1..3 are backlogged. Stopping while slot 1 is delivered suppresses
    // the later slots.
    fake.ms = slot_math.slotStartMs(cfg, 3);
    _ = clock.currentSlot();
    try expectEqualSlices(Slot, &.{1}, listener.seen());

    _ = clock.currentSlot();
    try expectEqualSlices(Slot, &.{1}, listener.seen());
}

test "waitForSlot returns when the target is already current" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 8,
    };
    var fake: FakeClockIo = .{ .ms = slot_math.slotStartMs(cfg, 0) };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    const current = clock.currentSlotOrGenesis();
    try clock.waitForSlot(current);
}

test "waitForSlot returns aborted on stop" {
    const rt = try zio.Runtime.init(testing.allocator, .{});
    defer rt.deinit();
    const io_handle = rt.io();

    var clock: Clock = undefined;
    try clock.init(testing.allocator, io_handle, .{
        .genesis_time_sec = time.nowSec(io_handle) + 2,
        .slot_duration_ms = 2_000,
        .slots_per_epoch = 8,
    });
    defer clock.deinit();

    var fut = try std.Io.concurrent(io_handle, Clock.waitForSlot, .{ &clock, 100 });
    try rendezvousWaiters(&clock, io_handle, 1);
    clock.stop();
    try testing.expectError(error.Aborted, fut.await(io_handle));
}

test "waitForSlot on a stopped clock returns error.Aborted" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 4,
    };
    var fake: FakeClockIo = .{ .ms = cfg.genesis_time_sec * 1000 - cfg.slot_duration_ms };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    clock.stop();
    try testing.expectError(error.Aborted, clock.waitForSlot(1));
}

test "reached waiters resolve while a future waiter remains pending" {
    const rt = try zio.Runtime.init(testing.allocator, .{});
    defer rt.deinit();
    const io_handle = rt.io();

    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 8,
    };
    var fake: FakeClockIo = .{ .ms = cfg.genesis_time_sec * 1000 - cfg.slot_duration_ms, .inner = io_handle };
    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    // Targets are registered out of order; all three calls are waiting before
    // the clock advances.
    var fut5 = try std.Io.concurrent(io_handle, Clock.waitForSlot, .{ &clock, 5 });
    var fut3 = try std.Io.concurrent(io_handle, Clock.waitForSlot, .{ &clock, 3 });
    var fut1 = try std.Io.concurrent(io_handle, Clock.waitForSlot, .{ &clock, 1 });
    try rendezvousWaiters(&clock, io_handle, 3);

    fake.ms = slot_math.slotStartMs(cfg, 3);
    _ = clock.currentSlot();

    try fut1.await(io_handle);
    try fut3.await(io_handle);

    clock.stop();
    try testing.expectError(error.Aborted, fut5.await(io_handle));
}

test "many waiters at same target slot all resolve on advance" {
    const rt = try zio.Runtime.init(testing.allocator, .{});
    defer rt.deinit();
    const io_handle = rt.io();

    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 4,
    };
    var fake: FakeClockIo = .{ .ms = cfg.genesis_time_sec * 1000 - cfg.slot_duration_ms, .inner = io_handle };
    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    const N = 16;
    var futs: [N]std.Io.Future(Error!void) = undefined;
    for (&futs) |*f| f.* = try std.Io.concurrent(io_handle, Clock.waitForSlot, .{ &clock, 5 });
    try rendezvousWaiters(&clock, io_handle, N);

    fake.ms = slot_math.slotStartMs(cfg, 5);
    _ = clock.currentSlot();

    for (&futs) |*f| try f.await(io_handle);
}

test "waitForSlot aborts when stop prevents delivery of its target" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 8,
    };
    var fake: FakeClockIo = .{ .ms = slot_math.slotStartMs(cfg, 0) };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    var listener: StopAtSlotListener = .{ .clock = &clock, .stop_at = 1 };
    _ = try clock.onSlot(StopAtSlotListener.onSlot, &listener);

    // The wall reaches slot 3, but stop at slot 1 prevents slot 2 from being
    // delivered, so a wait for slot 2 cannot succeed.
    fake.ms = slot_math.slotStartMs(cfg, 3);
    try testing.expectError(error.Aborted, clock.waitForSlot(2));
}

test "stop() during emit resolves a reached waiter and aborts a future one" {
    const rt = try zio.Runtime.init(testing.allocator, .{});
    defer rt.deinit();
    const io_handle = rt.io();

    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 4,
    };
    var fake: FakeClockIo = .{ .ms = cfg.genesis_time_sec * 1000 - cfg.slot_duration_ms, .inner = io_handle };
    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    const target: Slot = 3;
    var listener: StopAtSlotListener = .{ .clock = &clock, .stop_at = target };
    _ = try clock.onSlot(StopAtSlotListener.onSlot, &listener);

    var fut_reached = try std.Io.concurrent(io_handle, Clock.waitForSlot, .{ &clock, target });
    var fut_future = try std.Io.concurrent(io_handle, Clock.waitForSlot, .{ &clock, target + 1 });
    try rendezvousWaiters(&clock, io_handle, 2);

    fake.ms = slot_math.slotStartMs(cfg, target);
    _ = clock.currentSlot();

    // The target slot was delivered, so its wait resolves rather than aborting.
    try fut_reached.await(io_handle);
    // The next slot can never be emitted after the stop, so its wait aborts.
    try testing.expectError(error.Aborted, fut_future.await(io_handle));
}

fn nopSlot(_: ?*anyopaque, _: Slot) void {}
fn nopEpoch(_: ?*anyopaque, _: Epoch) void {}

test "ListenerLimitReached: onSlot/onEpoch reject the (limit+1)th registration" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 4,
    };
    var fake: FakeClockIo = .{ .ms = cfg.genesis_time_sec * 1000 - cfg.slot_duration_ms };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    for (0..Clock.max_slot_listeners) |_| {
        _ = try clock.onSlot(nopSlot, null);
    }
    try testing.expectError(error.ListenerLimitReached, clock.onSlot(nopSlot, null));

    for (0..Clock.max_epoch_listeners) |_| {
        _ = try clock.onEpoch(nopEpoch, null);
    }
    try testing.expectError(error.ListenerLimitReached, clock.onEpoch(nopEpoch, null));
}

test "WaiterLimitReached: waitForSlot rejects the (limit+1)th waiter" {
    const rt = try zio.Runtime.init(testing.allocator, .{});
    defer rt.deinit();
    const io_handle = rt.io();

    var clock: Clock = undefined;
    try clock.init(testing.allocator, io_handle, .{
        .genesis_time_sec = time.nowSec(io_handle) + 1_000_000,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 4,
    });
    defer clock.deinit();

    var futs: [Clock.max_waiters]std.Io.Future(Error!void) = undefined;
    for (&futs) |*f| {
        f.* = try std.Io.concurrent(io_handle, Clock.waitForSlot, .{ &clock, 999_999 });
    }
    var polls: usize = 0;
    while (clock.waiters.count() < Clock.max_waiters) : (polls += 1) {
        if (polls >= 100_000) return error.RendezvousTimeout;
        std.Io.sleep(io_handle, std.Io.Duration.fromMilliseconds(1), .awake) catch {};
    }

    try testing.expectError(error.WaiterLimitReached, clock.waitForSlot(999_999));

    clock.stop();
    for (&futs) |*f| {
        try testing.expectError(error.Aborted, f.await(io_handle));
    }
}

test "stop/join are idempotent" {
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = 100,
        .slot_duration_ms = 1_000,
        .slots_per_epoch = 8,
    };
    var fake: FakeClockIo = .{ .ms = cfg.genesis_time_sec * 1000 - cfg.slot_duration_ms };

    var clock: Clock = undefined;
    try clock.init(testing.allocator, fake.io(), cfg);
    defer clock.deinit();

    clock.stop();
    clock.stop();
    clock.join();
    clock.join();
}

test "real-time: the auto-loop delivers ordered slot events promptly" {
    const rt = try zio.Runtime.init(testing.allocator, .{});
    defer rt.deinit();
    const io_handle = rt.io();

    const slot_duration_ms: u64 = 1_000;
    const slots_to_wait: Slot = 2;
    const scheduler_headroom_ms: u64 = 1_000;
    const cfg: Clock.ClockConfig = .{
        .genesis_time_sec = time.nowSec(io_handle),
        .slot_duration_ms = slot_duration_ms,
        .slots_per_epoch = 8,
    };
    var clock: Clock = undefined;
    try clock.init(testing.allocator, io_handle, cfg);
    defer clock.deinit();

    var trace: EventTraceState = .{};
    _ = try clock.onSlot(EventTraceState.onSlot, &trace);

    try clock.start();

    const start_slot = clock.currentSlotOrGenesis();
    const target = start_slot + slots_to_wait;
    const before_ms = time.nowMs(io_handle);
    try clock.waitForSlot(target);
    const after_ms = time.nowMs(io_handle);

    // On wake-up the wall has reached the target slot's start.
    try testing.expect(after_ms >= slot_math.slotStartMs(cfg, target));
    const max_wait_ms = slots_to_wait * slot_duration_ms + scheduler_headroom_ms;
    try testing.expect(after_ms - before_ms < max_wait_ms);
    try testing.expect(trace.slot_len >= slots_to_wait);
    // Delivery reached the target; a further boundary may have added more.
    try testing.expect(trace.slots[trace.slot_len - 1] >= target);
    // Slots arrive in order, each once.
    for (1..trace.slot_len) |i| {
        try testing.expect(trace.slots[i] > trace.slots[i - 1]);
    }
}

test "real-time: stop+join cancels promptly" {
    const rt = try zio.Runtime.init(testing.allocator, .{});
    defer rt.deinit();
    const io_handle = rt.io();

    const slot_duration_ms: u64 = 12_000;
    const loop_start_grace_ms: i64 = 50;
    const shutdown_deadline_ms: u64 = 1_500;
    var clock: Clock = undefined;
    try clock.init(testing.allocator, io_handle, .{
        .genesis_time_sec = time.nowSec(io_handle),
        .slot_duration_ms = slot_duration_ms,
        .slots_per_epoch = 32,
    });
    defer clock.deinit();

    try clock.start();

    // Give the loop fiber time to enter its sleep.
    std.Io.sleep(io_handle, std.Io.Duration.fromMilliseconds(loop_start_grace_ms), .awake) catch {};

    const before_ms = time.nowMs(io_handle);
    clock.stop();
    clock.join();
    const elapsed = time.nowMs(io_handle) - before_ms;

    // Shutdown must not wait for the next slot boundary.
    try testing.expect(elapsed < shutdown_deadline_ms);
}
