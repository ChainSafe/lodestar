const std = @import("std");
const n = @import("network");
const d = @import("discv5");
const napi = @import("zapi:zapi").napi;
const Promise = @import("network_promise.zig");
const network_metrics = @import("network_metrics.zig");
const diagnostics = @import("network_diagnostics.zig");
const network_peer_reports = @import("network_peer_reports.zig");
const network_budget = @import("network_budget.zig");
const admission_capacity = @import("network_capacity.zig");
pub const gossip_mod = @import("network_gossip.zig");
pub const incoming_mod = @import("network_incoming.zig");
pub const requests_mod = @import("network_requests.zig");
pub const publications_mod = @import("network_publications.zig");
pub const commands = @import("network_commands.zig");
pub const application_config = @import("network_application_config.zig");
pub const projection = @import("network_peer_projection.zig");
const Wake = @import("network_wake.zig").Wake;
pub const DeliveryKind = enum { completions, admission_capacity, identity, peers, checks, serving, gossip };
pub const Owner = @import("network_owner.zig").Owner;
pub const allocator = std.heap.c_allocator;
pub const Reason = enum { requested, failed };
pub const Notify = napi.ThreadSafeFunction(Runtime, void);
const processor_metrics = n.metrics.processor;
var runtime_live = std.atomic.Value(bool).init(false);

/// Claims the one live runtime per process. The last `Runtime.release` returns the claim, also after a failed initialization.
pub fn create(env: napi.Env) !*Runtime {
    if (runtime_live.swap(true, .acq_rel)) return error.NetworkAlreadyInitialized;
    errdefer runtime_live.store(false, .release);
    const runtime = try allocator.create(Runtime);
    runtime.* = .{ .env = env };
    return runtime;
}

pub const Identity = struct {
    peer: n.PeerId,
    metadata: n.peers.types.Metadata,
    endpoints: [2]?n.Address,
    multiaddr: [n.wire.multiaddr.binary_length_max]u8,
    multiaddr_len: u8,
    enr: [d.wire.constants.enr_size_max]u8,
    enr_len: u16,
};
/// Standing host permissions, independent of one exchange's delivery allowance.
pub const Capacity = struct {
    gossip_validation: enum { ready, backpressured } = .backpressured,
};

/// Shared operation storage and lifecycle. Runtime lock/unlock guard state transitions; a claimed cell has one writer.
const Bridge = struct {
    mutex: std.Io.Mutex = .init,
    diagnostics: ?*diagnostics.Buffer = null,
    identity: ?Identity = null,
    peer_updates: ?*projection.Lane = null,
    commands: commands.Table = .{},
    reports: network_peer_reports.Table = .{},
    publications: ?publications_mod.Table = null,
    requests: ?requests_mod.Table = null,
    incoming: ?incoming_mod.Table = null,
    gossip: ?gossip_mod.Table = null,
    payload_budget: network_budget.Budget = .{},
    admission_capacity: admission_capacity.Tracker = .{},
    wake: ?Wake = null,
    notify: Notify = undefined,
    notify_live: bool = true,
    notification_armed: bool = true,
    capacity: ?Capacity = null,
    env_alive: bool = true,
    graceful: bool = false,
    stop: bool = false,
    reason: Reason = .requested,
    quiescent: bool = false,
    terminal_error: ?anyerror = null,
};

pub const Runtime = struct {
    bridge: Bridge = .{},
    logs: n.logging.Sink = .{},
    xray: ?*n.xray.Probe = null,
    metrics: network_metrics.Export = .{},
    refs: std.atomic.Value(u32) = .init(1),
    owner: ?*Owner = null,
    peer_capacity: u16 = 0,

    thread: ?std.Thread = null,
    /// JS thread: an exchange is running, so a nested one is refused.
    in_exchange: bool = false,
    hook_live: bool = false,
    env: napi.Env,
    closed: Promise = .{},

    // Network thread scheduling and counters, read after joining at teardown.
    closing_deadline: ?u64 = null,
    /// Owner thread: an event capture left host work for the next apply, so the next turn is due now.
    host_due: bool = false,
    owner_turns: u64 = 0,
    operational_failures: u64 = 0,

    pub fn retireRequest(self: *Runtime, token: requests_mod.Token) void {
        self.lock();
        self.bridge.requests.?.retire(token);
        self.unlock();
        self.release();
    }
    pub fn retireRequestStorageLocked(self: *Runtime) void {
        if (!self.bridge.quiescent) return;
        if (self.bridge.publications) |*table| table.trim();
        if (self.bridge.gossip) |*table| table.trim();
        if (self.bridge.incoming) |*table| {
            if (table.diag.occupied == 0) {
                table.backing.free(table.cells);
                table.cells = &.{};
            }
        }
        if (self.bridge.requests) |*table| {
            if (table.diag.occupied != 0) return;
            table.backing.free(table.cells);
            table.cells = &.{};
        }
    }
    pub fn retireDiagnosticsLocked(self: *Runtime) void {
        if (!self.bridge.quiescent or self.bridge.commands.diagnostic != null) return;
        if (self.bridge.diagnostics) |buffer| buffer.destroy();
        self.bridge.diagnostics = null;
    }
    fn destroyOwner(self: *Runtime) void {
        if (self.owner) |owner| {
            // Startup failure has no task; the owner joins running checkpoints before taking this lock.
            if (owner.checkpoint) |*checkpoint| checkpoint.deinit(owner.threaded.io());
            if (owner.core_live) {
                owner.core.shutdown((n.Now.read(owner.threaded.io()) catch owner.core.last_now).floor(owner.core.last_now));
                owner.core.deinit(owner.threaded.io());
            }
            if (owner.threaded_live) owner.threaded.deinit();
            owner.config.wipe();
            std.crypto.secureZero(u8, std.mem.asBytes(owner));
            allocator.destroy(owner);
            self.owner = null;
        }
    }
    /// Copies the processor state for one metrics render.
    pub fn captureProcessorLocked(self: *const Runtime, into: *processor_metrics.Snapshot) void {
        if (self.bridge.gossip) |*table| into.captureProcessor(table);
    }
    pub fn lock(self: *Runtime) void {
        std.Io.Threaded.mutexLock(&self.bridge.mutex);
    }
    pub fn unlock(self: *Runtime) void {
        self.refreshBridgeCapacityLocked();
        if (self.bridge.admission_capacity.pending) self.notifyIfReadyLocked();
        // A payload release while the owner waits for budget wakes it to retry.
        if (self.bridge.payload_budget.released) {
            self.bridge.payload_budget.released = false;
            self.wakeOwnerLocked();
        }
        std.Io.Threaded.mutexUnlock(&self.bridge.mutex);
    }
    pub fn refreshBridgeCapacityLocked(self: *Runtime) void {
        if (self.bridge.requests) |*table| self.bridge.admission_capacity.update(.bridge_slots, table.release_revision);
        if (self.bridge.publications) |*table| self.bridge.admission_capacity.update(.publication_slots, table.release_revision);
        self.bridge.admission_capacity.update(.command_slots, self.bridge.commands.release_revision);
        self.bridge.admission_capacity.update(.bridge_bytes, self.bridge.payload_budget.release_revision);
    }
    /// Owner thread only; core state is never read by JavaScript capacity watches.
    pub fn refreshRequestCapacityLocked(self: *Runtime) void {
        const protocols = &self.owner.?.core.protocols;
        self.bridge.admission_capacity.update(.requests, protocols.reqresp.outbound_release_revision);
        self.bridge.admission_capacity.update(.negotiations, protocols.router.negotiator.release_revision);
    }
    pub fn retain(self: *Runtime) void {
        _ = self.refs.fetchAdd(1, .monotonic);
    }
    pub fn release(self: *Runtime) void {
        if (self.refs.fetchSub(1, .acq_rel) == 1) {
            self.destroyOwner();
            if (self.xray) |probe| probe.destroy(allocator);
            self.metrics.deinit();
            if (self.bridge.diagnostics) |buffer| buffer.destroy();
            if (self.bridge.peer_updates) |lane| allocator.destroy(lane);
            if (self.bridge.publications) |*table| table.deinit();
            if (self.bridge.requests) |*requests| requests.deinit();
            if (self.bridge.incoming) |*incoming| incoming.deinit();
            if (self.bridge.gossip) |*gossip| gossip.deinit();
            std.debug.assert(self.bridge.payload_budget.used == 0);
            for (self.bridge.payload_budget.owned) |owned| std.debug.assert(owned == 0);
            std.crypto.secureZero(u8, std.mem.asBytes(self));
            allocator.destroy(self);
            const claimed = runtime_live.swap(false, .release);
            std.debug.assert(claimed);
        }
    }

    pub fn requestStop(self: *Runtime) void {
        self.lock();
        defer self.unlock();
        if (self.bridge.stop or self.bridge.quiescent) return;
        self.bridge.stop = true;
        self.wakeOwnerLocked();
        self.notifyIfReadyLocked();
    }
    pub fn wakeOwnerLocked(self: *Runtime) void {
        if (self.bridge.wake) |*wake| wake.signal() catch self.failLocked(error.NetworkWakeFailed);
    }
    /// Stops the owner for a terminal failure. The first one is the close result's error, also after a requested
    /// stop began.
    pub fn failLocked(self: *Runtime, err: anyerror) void {
        self.bridge.stop = true;
        if (self.bridge.reason == .failed) return;
        self.bridge.reason = .failed;
        self.bridge.terminal_error = err;
    }
    /// Must hold the bridge mutex. Delivery readiness ignores one exchange's temporary allowance.
    pub fn deliverableLocked(self: *Runtime, kind: DeliveryKind) bool {
        if (kind == .completions)
            return self.completionsReadyLocked() or (self.bridge.quiescent and self.closed.resolvers != null);
        if (self.bridge.quiescent and self.closed.resolvers == null) return false;
        if (kind == .admission_capacity) return self.bridge.admission_capacity.pending and !self.bridge.stop;
        if (kind == .identity) return self.bridge.identity != null;
        if (kind == .peers) return self.bridge.peer_updates != null and self.bridge.peer_updates.?.len > 0;
        const capacity = self.bridge.capacity orelse return false;
        if (self.bridge.stop or self.bridge.quiescent) return false;
        return switch (kind) {
            .checks => if (self.bridge.gossip) |*table| table.readiness().checks else false,
            .serving => self.bridge.incoming != null and self.bridge.incoming.?.oldest() != null,
            .gossip => if (self.bridge.gossip) |*table| blk: {
                const work = table.readiness();
                break :blk work.urgent or (work.ordinary and capacity.gossip_validation == .ready);
            } else false,
            .completions, .admission_capacity, .identity, .peers => unreachable,
        };
    }
    pub fn hasDeliveryLocked(self: *Runtime) bool {
        inline for (@typeInfo(DeliveryKind).@"enum".fields) |field| {
            if (self.deliverableLocked(@enumFromInt(field.value))) return true;
        }
        return false;
    }
    pub fn notifyIfReadyLocked(self: *Runtime) void {
        if (self.bridge.notification_armed and self.hasDeliveryLocked()) {
            self.bridge.notification_armed = false;
            self.notifyHostLocked();
        }
    }
    pub fn notifyHostLocked(self: *Runtime) void {
        if (!self.bridge.notify_live or !self.bridge.env_alive) return;
        self.bridge.notify.call(undefined, .non_blocking) catch |err| switch (err) {
            // An undequeued notification remains, and its exchange sees this work.
            error.QueueFull => {},
            error.Closing => {
                self.bridge.notify_live = false;
                self.bridge.stop = true;
            },
            else => self.failLocked(err),
        };
    }
    /// Whether any operation has a completion ready for delivery. O(1).
    pub fn completionsReadyLocked(self: *const Runtime) bool {
        return self.bridge.commands.anyTerminal() or
            (if (self.bridge.publications) |*table| table.anyTerminal() else false) or
            (if (self.bridge.requests) |*table| table.anyDue(self.bridge.stop, self.bridge.quiescent) else false) or
            (if (self.bridge.incoming) |*table| table.anyDue() else false);
    }
    pub fn join(self: *Runtime) void {
        if (self.thread) |thread| {
            thread.join();
            self.thread = null;
        }
    }
    pub fn removeHook(self: *Runtime) void {
        if (!self.hook_live) return;
        self.env.removeEnvCleanupHook(Runtime, self, cleanup) catch unreachable;
        self.hook_live = false;
        self.release();
    }
    pub fn forceStop(self: *Runtime) void {
        self.lock();
        self.bridge.env_alive = false;
        self.bridge.graceful = false;
        if (self.bridge.stop and !self.bridge.quiescent) self.wakeOwnerLocked();
        self.unlock();
        self.requestStop();
        self.join();
    }
    pub fn disposeJsReferences(self: *Runtime) void {
        self.closed.deinit();
    }
    /// Joins the owner and retires abandoned work before Node runs object finalizers.
    pub fn cleanup(self: *Runtime) void {
        self.hook_live = false;
        self.forceStop();
        std.debug.assert(self.bridge.quiescent);
        self.retireClosedPublications();
        self.retireClosedCommands();
        if (self.bridge.requests) |*requests| for (requests.cells, 0..) |*cell, i| {
            cell.copying = false;
            if (cell.state != .free) self.retireRequest(.{ .index = @intCast(i), .generation = cell.generation });
        };
        if (self.bridge.incoming) |*incoming| for (incoming.cells, 0..) |*cell, i| {
            cell.copying = false;
            if (cell.state != .free) {
                incoming.retire(.{ .index = @intCast(i), .generation = cell.generation });
            }
        };
        self.disposeJsReferences();
        self.release();
    }
    pub fn finalize(_: napi.Env, self: *Runtime) void {
        self.release();
    }

    pub fn cancelCommandsLocked(self: *Runtime) void {
        for (&self.bridge.commands.cells, 0..) |*cell, i| {
            switch (cell.state) {
                .queued, .executing, .waiting => {
                    self.bridge.commands.cells[i].failure = self.bridge.terminal_error orelse error.NetworkClosed;
                    self.bridge.commands.transition(cell, .terminal);
                },
                else => {},
            }
        }
    }
    pub fn finishOwner(self: *Runtime, failure: ?anyerror) void {
        if (failure) |err| {
            if (err != error.AbortError) std.log.scoped(.network_runtime).err("owner_failed reason={s}", .{@errorName(err)});
            self.lock();
            self.failLocked(err);
            self.unlock();
        }
        self.lock();
        // Destroy native borrows before the bridge completes its host-owned operations.
        // Global shutdown completes bridge operations without draining Core terminal events.
        self.destroyOwner();
        self.unlock();
        if (self.xray) |probe| probe.finish();
        self.lock();
        requests_mod.closeLocked(self);
        incoming_mod.closeLocked(self);
        gossip_mod.closeLocked(self);
        self.cancelCommandsLocked();
        if (self.bridge.publications) |*table| table.close(self.bridge.terminal_error orelse error.NetworkClosed);
        if (self.bridge.wake) |*wake| wake.deinit();
        self.bridge.wake = null;
        self.bridge.quiescent = true;
        self.retireDiagnosticsLocked();
        self.retireRequestStorageLocked();
        std.log.scoped(.network_runtime).info("owner_stopped reason={s} turns={d} operational_failures={d}", .{ @tagName(self.bridge.reason), self.owner_turns, self.operational_failures });
        // Every host sees quiescence, also one whose waiting payload left it disarmed.
        self.bridge.notification_armed = false;
        self.notifyHostLocked();
        const release_notify = self.bridge.notify_live;
        self.bridge.notify_live = false;
        self.unlock();
        if (release_notify) self.bridge.notify.release(.release) catch unreachable;
    }
    pub fn reservePublication(self: *Runtime, kind: n.gossipsub.topic.Kind, bytes: usize, blocked: ?*admission_capacity.Token) !publications_mod.Token {
        self.lock();
        defer self.unlock();
        if (self.bridge.stop or self.bridge.quiescent) return error.NetworkClosed;
        const token = self.bridge.publications.?.reserve(kind, bytes) catch |err| {
            if (blocked) |into| {
                self.refreshBridgeCapacityLocked();
                into.* = self.bridge.admission_capacity.token(if (err == error.PublicationQueueFull) .publication_slots else .bridge_bytes);
            }
            return err;
        };
        self.retain();
        return token;
    }
    pub fn retirePublication(self: *Runtime, token: publications_mod.Token) void {
        self.lock();
        self.bridge.publications.?.retire(token);
        self.retireRequestStorageLocked();
        self.unlock();
        self.release();
    }
    fn retireClosedPublications(self: *Runtime) void {
        for (0..publications_mod.capacity_max) |i| {
            if (self.bridge.publications == null or i >= self.bridge.publications.?.cells.len) break;
            const cell = &self.bridge.publications.?.cells[i];
            if (cell.state == .free) continue;
            std.debug.assert(cell.state == .terminal);
            self.retirePublication(.{ .index = @intCast(i), .generation = cell.generation });
        }
    }
    fn retireClosedCommands(self: *Runtime) void {
        for (0..commands.capacity) |i| {
            const cell = &self.bridge.commands.cells[i];
            if (cell.state == .free) continue;
            std.debug.assert(cell.state == .terminal);
            self.retireCommand(.{ .index = @intCast(i), .generation = cell.generation });
        }
    }
    pub fn reserveCommand(self: *Runtime, command: commands.Command, blocked: ?*admission_capacity.Token) !commands.Token {
        self.lock();
        defer self.unlock();
        if (self.bridge.stop or self.bridge.quiescent) return error.NetworkClosed;
        const token = self.bridge.commands.reserve(command) catch |err| {
            if (err == error.NetworkCommandFull) if (blocked) |into| {
                self.refreshBridgeCapacityLocked();
                into.* = self.bridge.admission_capacity.token(.command_slots);
            };
            if (err == error.NetworkSequenceExhausted) {
                self.failLocked(err);
                self.wakeOwnerLocked();
            }
            return err;
        };
        self.retain();
        return token;
    }
    pub fn retireCommand(self: *Runtime, token: commands.Token) void {
        self.lock();
        const released = self.bridge.commands.diagnostic == token.index;
        self.bridge.commands.retire(token);
        self.retireDiagnosticsLocked();
        if (released) self.wakeOwnerLocked();
        self.unlock();
        self.release();
    }
    pub fn queueCommand(self: *Runtime, token: commands.Token) !void {
        self.lock();
        defer self.unlock();
        if (self.bridge.stop or self.bridge.quiescent) return error.NetworkClosed;
        self.bridge.commands.transition(self.bridge.commands.get(token), .queued);
        self.wakeOwnerLocked();
    }
};

test {
    _ = @import("network_runtime_test.zig");
}
