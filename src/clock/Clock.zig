//! Event-driven beacon clock.
//!
//! Owns the stateful slot cursor (a cached `current_slot` over `slot_math`)
//! and an async I/O loop to emit slot/epoch events and dispatch waiters.
//! All public methods are safe to call from the main thread; the internal
//! loop runs as a single cooperative fiber.
//!
//! Designed for a cooperative single-fiber `std.Io` backend (e.g. zio).
//!
//! No mutex is used: under a single-fiber backend the only context switches
//! are at `await`/`sleep` yield points, and every read-modify of shared state
//! (listeners, waiter queue, `stopped`) completes synchronously between yields.
//! Two invariants make this safe:
//!   1. Listener callbacks run to completion inside an emit. They run on the
//!      emitting fiber's stack, so a callback must never suspend it: that
//!      stalls the remaining listeners of that slot and the whole drain.
//!      Safe to call from a callback:
//!        - onSlot / offSlot / onEpoch / offEpoch and stop;
//!        - any current* / isCurrent* accessor and the pure-read helpers.
//!      Forbidden from a callback:
//!        - `await` and `sleep`, and `waitForSlot`, which suspends its caller;
//!        - spawning (`std.Io.async` / `std.Io.concurrent` / `Group.async`):
//!          task registration can reschedule-yield, which is the same
//!          suspension.
//!      Work that must await belongs on its own fiber: either a worker woken by
//!      a yield-free handoff (`std.Io.Event.set` does not yield), or a fiber
//!      that loops on `waitForSlot`.
//!      A query while the cache lags the wall (a backlog) does not nest a
//!      dispatch. It returns the fresh wall time - possibly ahead of the
//!      events delivered so far - and the frame already emitting delivers
//!      the rest, in order, exactly once per (listener, event). E.g. the
//!      wall reaches slot 3 while slot 1 is still being emitted:
//!
//!        emit 1
//!          callback: currentSlot() returns 3; instead of emitting 2 and 3
//!                    itself, it stores pending_target = 3
//!        emit 2      <- the emitting frame sees pending_target and continues
//!        emit 3
//!   2. A wake-up pops its waiter from the queue *before* setting the event, so
//!      a resuming `waitForSlot` frame is never still referenced by the queue.
//! A multi-executor backend (zio with `executors > 1`, or `std.Io.Threaded`)
//! would break both and require real locking.

const std = @import("std");
const Allocator = std.mem.Allocator;
const bounded_array = @import("bounded_array");
const time = @import("time");
const slot_math = @import("slot_math.zig");

const Clock = @This();

allocator: Allocator,
io: std.Io,
config: ClockConfig,
current_slot: ?Slot = null,

stopped: bool = false,
dispatching: bool = false,
pending_target: ?Slot = null,
loop_future: ?std.Io.Future(void) = null,

// IDs start at 1 so callers can use 0 as an unset sentinel.
next_listener_id: ListenerId = 1,
slot_listeners: bounded_array.BoundedArray(SlotListenerEntry, max_slot_listeners) = .{},
epoch_listeners: bounded_array.BoundedArray(EpochListenerEntry, max_epoch_listeners) = .{},

waiters: WaiterQueue,

pub const Slot = slot_math.Slot;
pub const Epoch = slot_math.Epoch;
pub const ClockConfig = slot_math.ClockConfig;
pub const ListenerId = u64;

pub const max_slot_listeners: u32 = 16;
pub const max_epoch_listeners: u32 = 16;
pub const max_waiters: u32 = 1024;

pub const Error = error{
    InvalidConfig,
    OutOfMemory,
    ListenerLimitReached,
    WaiterLimitReached,
    Aborted,
    ConcurrencyUnavailable,
};

const WaitState = struct {
    event: std.Io.Event = .unset,
    aborted: bool = false,
};

const WaiterEntry = struct {
    target: Slot,
    state: *WaitState,
};

const SlotListenerEntry = struct {
    id: ListenerId,
    callback: *const fn (ctx: ?*anyopaque, slot: Slot) void,
    ctx: ?*anyopaque,
};

const EpochListenerEntry = struct {
    id: ListenerId,
    callback: *const fn (ctx: ?*anyopaque, epoch: Epoch) void,
    ctx: ?*anyopaque,
};

const WaiterQueue = std.PriorityQueue(WaiterEntry, void, struct {
    fn compare(_: void, a: WaiterEntry, b: WaiterEntry) std.math.Order {
        return std.math.order(a.target, b.target);
    }
}.compare);

pub fn init(
    self: *Clock,
    allocator: Allocator,
    io_handle: std.Io,
    config: ClockConfig,
) Error!void {
    try config.validate();
    self.* = .{
        .allocator = allocator,
        .io = io_handle,
        .config = config,
        .current_slot = slot_math.slotAtMs(config, time.nowMs(io_handle)),
        .waiters = WaiterQueue.initContext({}),
    };
    // Reserve full waiter capacity up front so waitForSlot's push after the
    // limit check can neither allocate nor fail.
    try self.waiters.ensureTotalCapacity(allocator, max_waiters);
}

/// Start the auto-advance loop.  Idempotent.
pub fn start(self: *Clock) Error!void {
    if (self.loop_future != null) return;
    self.loop_future = try std.Io.concurrent(self.io, Clock.runAutoLoop, .{self});
}

/// Signal the loop to stop and abort all pending waiters.  Idempotent.
pub fn stop(self: *Clock) void {
    if (self.stopped) return;
    self.stopped = true;
    self.abortAllWaiters();
}

/// Signal the loop to stop, cancel the fiber, and wait for it to finish.
pub fn join(self: *Clock) void {
    self.stop();
    var maybe_future = self.loop_future;
    self.loop_future = null;
    if (maybe_future) |*future| {
        future.cancel(self.io);
    }
}

/// Release all resources.  Calls `stop()` + `join()` internally.
pub fn deinit(self: *Clock) void {
    self.stop();
    self.join();
    self.waiters.deinit(self.allocator);
    self.* = undefined;
}

/// Register a slot listener.  Returns an ID for later removal via `offSlot`.
pub fn onSlot(
    self: *Clock,
    callback: *const fn (ctx: ?*anyopaque, slot: Slot) void,
    ctx: ?*anyopaque,
) Error!ListenerId {
    if (self.slot_listeners.full()) return error.ListenerLimitReached;
    self.slot_listeners.push(.{
        .id = self.next_listener_id,
        .callback = callback,
        .ctx = ctx,
    });
    const id = self.next_listener_id;
    self.next_listener_id += 1;
    return id;
}

/// Unregister a slot listener.  Returns `true` if found and removed.
pub fn offSlot(self: *Clock, id: ListenerId) bool {
    for (self.slot_listeners.slice(), 0..) |listener, i| {
        if (listener.id == id) {
            self.slot_listeners.orderedRemove(@intCast(i));
            return true;
        }
    }
    return false;
}

/// Register an epoch listener.  Returns an ID for later removal via `offEpoch`.
/// An epoch event fires once when the epoch of the advancing slot increases.
pub fn onEpoch(
    self: *Clock,
    callback: *const fn (ctx: ?*anyopaque, epoch: Epoch) void,
    ctx: ?*anyopaque,
) Error!ListenerId {
    if (self.epoch_listeners.full()) return error.ListenerLimitReached;
    self.epoch_listeners.push(.{
        .id = self.next_listener_id,
        .callback = callback,
        .ctx = ctx,
    });
    const id = self.next_listener_id;
    self.next_listener_id += 1;
    return id;
}

/// Unregister an epoch listener.  Returns `true` if found and removed.
pub fn offEpoch(self: *Clock, id: ListenerId) bool {
    for (self.epoch_listeners.slice(), 0..) |listener, i| {
        if (listener.id == id) {
            self.epoch_listeners.orderedRemove(@intCast(i));
            return true;
        }
    }
    return false;
}

// Each "current" accessor derives from catchUp()'s single wall-clock read; a
// separate time.nowMs (the pure-read shape below) could land in a slot whose
// events have not been delivered yet.

pub fn currentSlot(self: *Clock) ?Slot {
    return self.catchUp().slot;
}

pub fn currentEpoch(self: *Clock) ?Epoch {
    const slot = self.catchUp().slot orelse return null;
    return slot_math.epochAtSlot(self.config, slot);
}

pub fn currentSlotOrGenesis(self: *Clock) Slot {
    return self.currentSlot() orelse 0;
}

pub fn currentEpochOrGenesis(self: *Clock) Epoch {
    return self.currentEpoch() orelse 0;
}

pub fn currentSlotWithGossipDisparity(self: *Clock) ?Slot {
    return slot_math.slotWithGossipDisparity(self.config, self.catchUp().now_ms);
}

pub fn isCurrentSlotGivenGossipDisparity(self: *Clock, slot: Slot) bool {
    return slot_math.isCurrentSlotGivenGossipDisparity(self.config, slot, self.catchUp().now_ms);
}

// Unlike the catchUp-backed accessors above, the helpers below are pure
// reads: they never advance the cache and never emit events.

/// Returns the slot if the internal clock were advanced by `tolerance_ms`.
pub fn slotWithFutureToleranceMs(self: *const Clock, tolerance_ms: u64) ?Slot {
    return slot_math.slotWithFutureToleranceMs(self.config, time.nowMs(self.io), tolerance_ms);
}

/// Returns the slot if the internal clock were reversed by `tolerance_ms`.
pub fn slotWithPastToleranceMs(self: *const Clock, tolerance_ms: u64) Slot {
    return slot_math.slotWithPastToleranceMs(self.config, time.nowMs(self.io), tolerance_ms);
}

/// Returns the seconds from the start of `slot` to `to_sec` (or now).
pub fn secFromSlot(self: *const Clock, slot: Slot, to_sec: ?u64) i64 {
    return slot_math.secFromSlot(
        self.config,
        slot,
        to_sec orelse @divFloor(time.nowMs(self.io), 1000),
    );
}

/// Returns the milliseconds from the start of `slot` to `to_ms` (or now).
pub fn msFromSlot(self: *const Clock, slot: Slot, to_ms: ?u64) i64 {
    return slot_math.msFromSlot(self.config, slot, to_ms orelse time.nowMs(self.io));
}

/// Suspend the calling fiber until the clock reaches `target`, then return.
/// Returns immediately if `target` has already been reached, and
/// `error.Aborted` if the clock is stopped before or during the wait.
///
/// Reachable errors: {Aborted, WaiterLimitReached}.
///
/// The wait is not a cancellation point: an external fiber-cancel takes effect
/// only once the wait resolves via dispatch or stop(). A wait on a clock that
/// is never started and never read blocks until stop().
///
/// Must NEVER be called from a listener callback.
pub fn waitForSlot(self: *Clock, target: Slot) Error!void {
    if (self.stopped) return error.Aborted;
    _ = self.catchUp();
    // Reached is judged by the cursor, not the wall time catchUp returned. A
    // stop during the drain suppresses events past the cursor, and a wait for
    // a suppressed slot must abort rather than resolve.
    if (self.current_slot) |slot| {
        if (slot >= target) return;
    }
    if (self.waiters.count() >= max_waiters) return error.WaiterLimitReached;
    // A catchUp callback may have called stop(); checked after the
    // reached-check so a wait that reached its target still resolves.
    if (self.stopped) return error.Aborted;

    var waiter: WaitState = .{};
    // Capacity was reserved at init and count < max_waiters here.
    self.waiters.push(self.allocator, .{ .target = target, .state = &waiter }) catch unreachable;
    // Checks that waitForSlot was not called from a listener callback.
    if (self.current_slot) |cs| std.debug.assert(self.waiters.peek().?.target > cs);

    waiter.event.waitUncancelable(self.io);
    return if (waiter.aborted) error.Aborted else {};
}

const WallTime = struct { now_ms: u64, slot: ?Slot };

/// Advance to wall-clock time, emitting any pending slot/epoch events, and
/// return the wall time it used. Emits nothing if already caught up or pre-genesis.
///
/// Normally catchUp drains every pending event before returning, so the
/// returned slot is never ahead of delivery. The two exceptions are a query
/// from inside a listener callback (see the reentrancy notes in the file
/// header) and a stop() from a callback, which freezes the cursor and
/// suppresses the slots past it.
fn catchUp(self: *Clock) WallTime {
    const now_ms = time.nowMs(self.io);
    const slot = slot_math.slotAtMs(self.config, now_ms);
    const wall_time: WallTime = .{ .now_ms = now_ms, .slot = slot };
    const target = slot orelse return wall_time;

    if (self.dispatching) {
        // A reentrant query only records the target; the frame that set
        // `dispatching` drains it. @max: a wall step-back (NTP) must not
        // regress a recorded target.
        self.pending_target = @max(self.pending_target orelse target, target);
        return wall_time;
    }
    self.dispatching = true;
    defer self.dispatching = false;
    // The pending defer runs before the dispatching defer, so pending is null
    // whenever dispatching is false.
    std.debug.assert(self.pending_target == null);
    self.pending_target = target;
    // Backstop: a stopped exit leaves the loop with pending still set.
    defer self.pending_target = null;
    while (!self.stopped) {
        const drain_target = self.pending_target orelse break;
        self.pending_target = null;
        self.dispatchTo(drain_target);
    }
    return wall_time;
}

fn emitSlot(self: *Clock, slot: Slot) void {
    std.debug.assert(self.dispatching);
    var snapshot = self.slot_listeners;
    for (snapshot.slice()) |listener| {
        listener.callback(listener.ctx, slot);
    }
}

fn emitEpoch(self: *Clock, epoch: Epoch) void {
    std.debug.assert(self.dispatching);
    var snapshot = self.epoch_listeners;
    for (snapshot.slice()) |listener| {
        listener.callback(listener.ctx, epoch);
    }
}

fn dispatchWaiters(self: *Clock, current_slot: ?Slot) void {
    std.debug.assert(self.dispatching);
    const slot = current_slot orelse return;
    while (self.waiters.peek()) |head| {
        if (head.target > slot) break;
        const waiter = self.waiters.pop().?;
        // Checks that nothing set aborted while the entry was still queued.
        std.debug.assert(!waiter.state.aborted);
        waiter.state.event.set(self.io);
    }
}

fn abortAllWaiters(self: *Clock) void {
    while (self.waiters.pop()) |waiter| {
        // A reached target already satisfied the wait (waitForSlot resolves
        // once current_slot >= target); stopping only aborts slots that can
        // no longer be emitted.
        const reached = if (self.current_slot) |cs| waiter.target <= cs else false;
        waiter.state.aborted = !reached;
        waiter.state.event.set(self.io);
    }
}

const Event = union(enum) {
    slot: Slot,
    epoch: Epoch,
};

const AdvanceIterator = struct {
    config: ClockConfig,
    current_slot: *?Slot,
    target: Slot,
    pending_epoch: ?Epoch = null,

    /// Advances the clock one step at a time, yielding slot and epoch events.
    /// For each slot advancement: yields .slot first, then .epoch if an epoch
    /// boundary was crossed.
    /// Returns null when caught up to target.
    fn next(self: *AdvanceIterator) ?Event {
        if (self.pending_epoch) |epoch| {
            self.pending_epoch = null;
            return .{ .epoch = epoch };
        }

        const current = self.current_slot.*;
        if (current == null) {
            self.current_slot.* = 0;
            return .{ .slot = 0 };
        }

        const cur = current.?;
        if (cur >= self.target) return null;

        const next_slot = cur + 1;
        self.current_slot.* = next_slot;

        const prev_epoch = slot_math.epochAtSlot(self.config, cur);
        const new_epoch = slot_math.epochAtSlot(self.config, next_slot);
        if (prev_epoch < new_epoch) {
            self.pending_epoch = new_epoch;
        }

        return .{ .slot = next_slot };
    }
};

/// Advances the clock toward `target` one event at a time.  Stopping early
/// is legal: the cursor simply stays at the last slot the iterator yielded,
/// nothing rolls back.
fn advanceTo(self: *Clock, target: Slot) AdvanceIterator {
    return .{
        .config = self.config,
        .current_slot = &self.current_slot,
        .target = target,
    };
}

/// Walk the cursor to `target`, emitting each event.
fn dispatchTo(self: *Clock, target: Slot) void {
    std.debug.assert(self.dispatching);
    var iter = self.advanceTo(target);
    // Check `stopped` before iter.next() so a callback that calls stop()
    // can't leave current_slot one ahead of the last-emitted slot.
    while (true) {
        if (self.stopped) break;
        const event = iter.next() orelse break;
        switch (event) {
            .slot => |s| {
                self.emitSlot(s);
                self.dispatchWaiters(s);
            },
            .epoch => |e| self.emitEpoch(e),
        }
    }
}

fn runAutoLoop(self: *Clock) void {
    while (!self.stopped) {
        const now_ms = time.nowMs(self.io);
        const next_ms = slot_math.msUntilNextSlot(self.config, now_ms);
        const sleep_ms: i64 = @intCast(@max(@as(u64, 1), next_ms));

        // error.Canceled comes from join()'s fiber-cancel.
        std.Io.sleep(
            self.io,
            std.Io.Duration.fromMilliseconds(sleep_ms),
            .boot,
        ) catch break;

        if (self.stopped) break;
        _ = self.catchUp();
    }
    // join() calls stop() before cancelling the fiber, so the Canceled break
    // also exits with stopped set.
    std.debug.assert(self.stopped);
}

test {
    _ = @import("clock_test.zig");
}
