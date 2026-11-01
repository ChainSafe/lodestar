//! Owns bounded liveness and replacement probes. Discovery lookups belong to the application.

const std = @import("std");
const CallTable = @import("CallTable.zig");
const Engine = @import("Engine.zig");
const enr = @import("identity/enr.zig");
const message = @import("wire/message.zig");
const RoutingTable = @import("RoutingTable.zig");
const types = @import("types.zig");
const AddressVotes = @import("AddressVotes.zig");

pub const probe_attempts_max: u8 = 2;
pub const Error = Engine.Error || error{InvalidConfig};
pub const Failure = enum { expired, local };
pub const Config = struct {
    probe_interval_ms: u64 = 1_000,
    stale_after_ms: u64 = 300_000,
    retry_interval_ms: u64 = 1_000,
};

const Pending = struct {
    entry: RoutingTable.Entry,
    handle: ?CallTable.Handle = null,
    kind: enum { ping, enr } = .ping,
    attempts: u8 = 0,
    ready_ms: u64,
    origin: enum { stale, replacement, observation } = .stale,
};

const Maintenance = @This();
config: Config,
ip_mode: types.Mode,
pending: ?Pending = null,
probe_cursor: usize = 0,
probe_due_ms: u64,
next_start_ms: ?u64,
observations: ?*AddressVotes = null,
observation_cursor: [2]usize = .{ 0, 0 },
observation_due_ms: u64 = 0,
prefer_observation: bool = false,
observation_family: u1 = 0,

pub fn init(
    self: *Maintenance,
    now_ms: u64,
    config: Config,
    ip_mode: types.Mode,
) Error!void {
    inline for (std.meta.fields(Config)) |field| {
        if (@field(config, field.name) == 0) return error.InvalidConfig;
    }
    const probe_due_ms = now_ms +| config.probe_interval_ms;
    self.* = .{
        .config = config,
        .ip_mode = ip_mode,
        .probe_due_ms = probe_due_ms,
        .next_start_ms = probe_due_ms,
    };
}

pub fn nextDeadlineMs(self: *const Maintenance, core: *const Engine) ?u64 {
    const next = self.next_start_ms orelse return null;
    if (self.pending == null) if (core.routing.revalidationTarget()) |entry| {
        if (self.ip_mode.supports(entry.peer.address) and !core.isPeerBusy(&entry.peer.node_id)) return 0;
    };
    return next;
}

/// Starts at most one call. The host sends the returned packet, forwards owned events and
/// expiries, and retries at this controller's deadline or after an event releases a call.
pub fn startNext(
    self: *Maintenance,
    core: *Engine,
    out: []u8,
    request_id: message.RequestId,
    now_ms: u64,
    entropy: *const Engine.StartEntropy,
) Error!?Engine.OutboundCall {
    if (now_ms < (self.nextDeadlineMs(core) orelse return null)) return null;
    self.next_start_ms = now_ms +| self.config.retry_interval_ms;
    self.selectProbe(core, now_ms);
    if (self.pending) |*pending| {
        if (pending.handle == null and now_ms >= pending.ready_ms and
            !core.isPeerBusy(&pending.entry.peer.node_id))
        {
            const request = switch (pending.kind) {
                .ping => message.Message{ .ping = .{
                    .request_id = request_id,
                    .enr_sequence = core.localRecord().sequence,
                } },
                .enr => message.Message{ .find_node = .{
                    .request_id = request_id,
                    .distances = &.{0},
                } },
            };
            const call = core.startCall(
                out,
                pending.entry.peer,
                &pending.entry.record,
                &request,
                now_ms,
                entropy,
            ) catch |err| switch (err) {
                error.PeerBusy, error.TableFull => return null,
                else => return err,
            };
            pending.handle = call.handle;
            pending.attempts += 1;
            if (pending.origin == .observation and pending.kind == .ping) {
                self.observations.?.attempted(&pending.entry.peer, call.handle, now_ms);
                self.observation_due_ms = now_ms +| AddressVotes.probe_interval_ms;
            }
            self.next_start_ms = now_ms;
            return .{ .peer = pending.entry.peer, .call = call };
        }
    }
    self.scheduleNext(now_ms);
    return null;
}

pub fn onEvent(
    self: *Maintenance,
    core: *Engine,
    event: *const Engine.Event,
    now_ms: u64,
) Engine.Event.Consumption {
    switch (event.*) {
        .response => |*response| {
            if (self.pending) |*pending| {
                if (pending.handle) |handle| {
                    if (std.meta.eql(handle, response.matched.handle)) {
                        const result = Engine.Event.Consumption{
                            .consumed = true,
                            .responder = if (response.matched.terminal) pending.entry.record else null,
                        };
                        self.onProbeResponse(core, response, now_ms);
                        self.next_start_ms = now_ms;
                        return result;
                    }
                }
            }
            if (self.pending == null and self.next_start_ms != null and
                response.matched.response == .pong)
            {
                const entry = core.peerRecord(&response.peer.node_id) orelse return .{};
                if (!entry.peer.eql(&response.peer)) return .{};
                if (response.matched.response.pong.enr_sequence > entry.record.sequence) {
                    self.pending = .{ .entry = entry, .kind = .enr, .ready_ms = now_ms };
                    self.next_start_ms = now_ms;
                }
            }
        },
        .failed => |failed| return .{ .consumed = self.onFailure(core, failed.handle, now_ms, .local) },
        else => {},
    }
    return .{};
}

pub fn onFailure(
    self: *Maintenance,
    core: *Engine,
    handle: CallTable.Handle,
    now_ms: u64,
    reason: Failure,
) bool {
    if (self.pending) |*pending| {
        if (pending.handle) |owned| {
            if (std.meta.eql(handle, owned)) {
                _ = core.cancelCall(handle);
                if (pending.origin == .observation) {
                    if (reason == .local) self.observations.?.localFailure(&pending.entry.peer, handle);
                    self.pending = null;
                    self.next_start_ms = now_ms +| self.config.retry_interval_ms;
                    return true;
                }
                if (pending.origin == .replacement and pending.kind == .ping) {
                    if (core.peerRecord(&pending.entry.peer.node_id)) |entry| {
                        if (entry.last_verified_ms != pending.entry.last_verified_ms) {
                            core.routing.abandonRevalidation(&pending.entry.peer.node_id);
                            self.pending = null;
                            self.next_start_ms = now_ms;
                            return true;
                        }
                    }
                    if (reason == .local or pending.attempts < probe_attempts_max) {
                        if (pending.attempts >= probe_attempts_max) {
                            core.routing.abandonRevalidation(&pending.entry.peer.node_id);
                            self.pending = null;
                            self.next_start_ms = now_ms;
                            return true;
                        }
                        pending.handle = null;
                        pending.ready_ms = now_ms +| self.config.retry_interval_ms;
                        self.next_start_ms = pending.ready_ms;
                        return true;
                    }
                    if (core.peerRecord(&pending.entry.peer.node_id)) |entry| {
                        if (entry.last_verified_ms == pending.entry.last_verified_ms) {
                            _ = core.routing.resolveRevalidation(&entry.peer.node_id, false, now_ms) catch |err| switch (err) {
                                error.NoPendingRevalidation => {},
                                else => unreachable,
                            };
                        }
                    }
                    self.pending = null;
                    self.next_start_ms = now_ms;
                    return true;
                }
                if (reason == .expired and pending.kind == .ping) {
                    if (pending.attempts < probe_attempts_max) {
                        pending.handle = null;
                        pending.ready_ms = now_ms +| self.config.retry_interval_ms;
                        self.next_start_ms = pending.ready_ms;
                        return true;
                    }
                    _ = core.markPeerUnresponsive(
                        &pending.entry.peer.node_id,
                        pending.entry.last_verified_ms.?,
                    );
                }
                self.pending = null;
                self.next_start_ms = now_ms;
                return true;
            }
        }
    }
    return false;
}

pub fn cancel(self: *Maintenance, core: *Engine) void {
    if (self.pending) |pending| {
        if (pending.handle) |handle| _ = core.cancelCall(handle);
    }
    self.pending = null;
    self.next_start_ms = null;
}

fn selectProbe(self: *Maintenance, core: *Engine, now_ms: u64) void {
    if (self.pending) |pending| {
        if (pending.handle != null) return;
        if (!core.isPeerBusy(&pending.entry.peer.node_id) and
            (pending.origin != .observation or pending.kind != .ping or self.observations.?.canProbe(&pending.entry.peer, now_ms))) return;
        self.pending = null;
        self.probe_due_ms = @min(self.probe_due_ms, now_ms);
    }
    for (0..2) |turn| {
        const observe = if (turn == 0) self.prefer_observation else !self.prefer_observation;
        if (observe) {
            for (0..2) |offset| {
                const family = (self.observation_family + offset) % 2;
                if (self.selectObservation(core, family, now_ms)) {
                    self.observation_family = @intCast(1 - family);
                    self.prefer_observation = false;
                    return;
                }
            }
            continue;
        }
        if (core.routing.revalidationTarget()) |entry| {
            if (self.ip_mode.supports(entry.peer.address) and !core.isPeerBusy(&entry.peer.node_id)) {
                self.pending = .{ .entry = entry, .ready_ms = now_ms, .origin = .replacement };
                self.prefer_observation = true;
                return;
            }
        }
        if (now_ms < self.probe_due_ms) continue;
        self.probe_due_ms = now_ms +| self.config.probe_interval_ms;
        const entry = core.maintenanceTarget(&self.probe_cursor, now_ms, self.config.stale_after_ms) orelse continue;
        if (!self.ip_mode.supports(entry.peer.address) or core.isPeerBusy(&entry.peer.node_id)) continue;
        self.pending = .{ .entry = entry, .ready_ms = now_ms };
        self.prefer_observation = true;
        return;
    }
    if (now_ms >= self.observation_due_ms) self.observation_due_ms = now_ms +| AddressVotes.probe_interval_ms;
}

fn selectObservation(self: *Maintenance, core: *Engine, family: usize, now_ms: u64) bool {
    const observations = self.observations orelse return false;
    if (now_ms < self.observation_due_ms or !observations.needsSample(family, now_ms)) return false;
    const mode: types.Mode = if (family == 0) .ip4 else .ip6;
    var iterator = core.routing.iterate(&self.observation_cursor[family]);
    while (iterator.next()) |copied| {
        var entry = copied;
        const address = entry.record.endpointFor(mode) orelse continue;
        if (!self.ip_mode.supports(address) or core.isPeerBusy(&entry.peer.node_id)) continue;
        entry.peer.address = address;
        if (!observations.canProbe(&entry.peer, now_ms)) continue;
        self.pending = .{ .entry = entry, .ready_ms = now_ms, .origin = .observation };
        return true;
    }
    return false;
}

fn onProbeResponse(
    self: *Maintenance,
    core: *Engine,
    response: *const Engine.AuthenticatedResponse,
    now_ms: u64,
) void {
    const pending = &self.pending.?;
    std.debug.assert(pending.entry.peer.eql(&response.peer));
    switch (pending.kind) {
        .ping => {
            std.debug.assert(response.matched.response == .pong);
            const record = response.record orelse pending.entry.record;
            _ = core.confirmPeer(&response.peer, &record, now_ms) catch {};
            const known = core.peerRecord(&response.peer.node_id);
            const sequence = if (known) |entry| entry.record.sequence else record.sequence;
            if (response.matched.response.pong.enr_sequence > sequence) {
                pending.kind = .enr;
                pending.handle = null;
                pending.ready_ms = now_ms;
                pending.attempts = 0;
                return;
            }
        },
        .enr => {
            std.debug.assert(response.matched.response == .nodes);
            for (response.node_records) |*record| {
                if (!std.mem.eql(u8, &record.node_id, &response.peer.node_id)) continue;
                if (record.sequence <= pending.entry.record.sequence) continue;
                _ = core.confirmPeer(&response.peer, record, now_ms) catch {};
            }
            if (!response.matched.terminal) return;
        },
    }
    self.pending = null;
}

fn scheduleNext(self: *Maintenance, now_ms: u64) void {
    var next = if (self.pending) |pending|
        if (pending.handle == null) @max(pending.ready_ms, now_ms +| self.config.retry_interval_ms) else std.math.maxInt(u64)
    else
        self.probe_due_ms;
    if (self.pending == null and self.observations != null) next = @min(next, self.observation_due_ms);
    self.next_start_ms = @max(next, now_ms +| 1);
}

comptime {
    std.debug.assert(@sizeOf(Maintenance) <= 1_024);
}

test {
    _ = @import("maintenance_test.zig");
}
