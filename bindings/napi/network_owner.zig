const std = @import("std");
const Now = @import("network").Now;
const n = @import("network");
const d = @import("discv5");
const r = @import("network_runtime.zig");
const Runtime = r.Runtime;
const allocator = r.allocator;
const Config = @import("network_config.zig").Config;
const application_config = @import("network_application_config.zig");
const commands = @import("network_commands.zig");
const gossip_mod = @import("network_gossip.zig");
const incoming_mod = @import("network_incoming.zig");
const requests_mod = @import("network_requests.zig");
const publications = @import("network_publications.zig");
const processor_metrics = n.metrics.processor;
const network_wake = @import("network_wake.zig");
const config = @import("config");
const test_support = @import("network_test_support.zig");

pub const Owner = struct {
    threaded_live: bool = false,
    core_live: bool = false,
    config: Config = undefined,
    resolved: n.configuration.Resolved = undefined,
    core: n.NetworkCore = undefined,
    threaded: std.Io.Threaded = undefined,
    key: n.KeyPair = undefined,
    records: [n.peers.Discovery.bootstrap_max]d.identity.enr.Record = undefined,
    outputs: [32]n.peers.Event = undefined,
    application_outputs: [32]n.reqresp.ReqResp.Event = undefined,
    application: application_config.Config = undefined,
    state: ?n.application_state.State = null,
    processor_metrics: processor_metrics.Snapshot = .{},
    checkpoint: ?n.peers.RememberedCheckpoint = null,
    remembered_due_ms: u64 = 0,
    identity_revision: u64 = 0,

    pub fn readIdentity(self: *const Owner) !r.Identity {
        var identity: r.Identity = undefined;
        identity.peer = self.core.peerId();
        identity.metadata = self.core.localState().metadata;
        identity.endpoints = self.core.transport.sockets.localAddresses();
        const multiaddr = self.core.localMultiaddr();
        identity.multiaddr_len = @intCast((try multiaddr.encode(&identity.multiaddr)).len);
        identity.enr_len = 0;
        if (self.core.localRecord()) |record| {
            identity.enr_len = @intCast(record.slice().len);
            @memcpy(identity.enr[0..identity.enr_len], record.slice());
        }
        return identity;
    }
};

pub fn prepareConfiguration(self: *Runtime) !void {
    // The sole concurrency slot belongs to remembered-peer checkpoints.
    self.owner.?.threaded = std.Io.Threaded.init(allocator, .{ .async_limit = .nothing, .concurrent_limit = .limited(1) });
    self.owner.?.threaded_live = true;
    const io = self.owner.?.threaded.io();
    var seed: u64 = undefined;
    try io.randomSecure(std.mem.asBytes(&seed));
    try io.randomSecure(std.mem.asBytes(&self.bridge.admission_capacity.instance));
    const options = try self.owner.?.application.buildOptions(&self.owner.?.config, seed);
    self.owner.?.resolved = n.configuration.resolve(options) catch |err| switch (err) {
        error.InvalidLimits => return error.InvalidNetworkConfig,
        else => return err,
    };
}

pub fn initialize(self: *Runtime) !void {
    std.debug.assert(self.thread == null);
    const previous_log = n.logging.bind(&self.logs);
    defer _ = n.logging.bind(previous_log);
    std.log.scoped(.network_runtime).info("owner_initializing", .{});
    const io = self.owner.?.threaded.io();
    self.owner.?.key = try n.KeyPair.fromSecretKey(&self.owner.?.config.secret);

    self.owner.?.config.wipe();
    for (0..self.owner.?.config.bootstrap_count) |i| {
        self.owner.?.records[i] = try d.identity.enr.Record.init(self.owner.?.config.bootstrap[i].bytes[0..self.owner.?.config.bootstrap[i].len]);
    }
    const seeds = loadRemembered(self, io);
    const now = try Now.read(io);
    self.owner.?.remembered_due_ms = now.millis() +| n.peers.RememberedCheckpoint.interval_ms;
    var clock = self.owner.?.config.clock;
    const slot: u64 = @intCast(@max(0, try clock.read(now)));
    const update = try self.owner.?.config.chain.update(self.owner.?.config.local, null, slot);
    self.owner.?.resolved.core.protocols.router.capabilities = update.capabilities;
    self.owner.?.resolved.core.protocols.gossipsub.initial_slot = slot;
    try self.owner.?.core.init(allocator, io, &self.owner.?.resolved, .{
        .host = &self.owner.?.key,
        .bind = self.owner.?.config.bind,
        .local = update.local,
        .schedule = update.schedule,
        .clock = clock,
        .remembered = seeds,
        .discovery = if (self.owner.?.config.discovery_bind) |bind| .{ .bind = bind, .sequence = self.owner.?.config.discovery_sequence, .advertisement = self.owner.?.config.advertisement, .fixed = self.owner.?.config.fixed, .bootstrap = self.owner.?.records[0..self.owner.?.config.bootstrap_count] } else null,
    });
    self.owner.?.core_live = true;
    self.owner.?.state = try n.application_state.State.init(&self.owner.?.config.state, &self.owner.?.config.chain, &self.owner.?.core.peerId(), &self.owner.?.config.local);
    try self.owner.?.state.?.advance(&self.owner.?.core, &self.owner.?.config.chain, now);
    self.owner.?.core.protocols.gossipsub.trace_gossip = self.owner.?.application.trace_gossip;
    if (self.owner.?.application.xray) |*options| {
        const peer = self.owner.?.core.peerId();
        self.xray = try n.xray.Probe.create(allocator, std.Io.Threaded.global_single_threaded.io(), self.owner.?.resolved.limits.connections_max, &options.endpoint, &peer, self.owner.?.application.agent[0..self.owner.?.application.agent_len]);
        self.owner.?.core.transport.engine.stream_capture = &self.xray.?.capture;
        if (options.wait_for_attach) try self.xray.?.waitForAttach();
    }
    try self.owner.?.core.setHostWake(self.bridge.wake.?.read_fd);

    std.log.scoped(.network_runtime).info("owner_initialized target_peers={d} max_peers={d}", .{ self.owner.?.resolved.core.peers.target_peers, self.owner.?.resolved.core.peers.max_peers });
}
pub fn run(self: *Runtime) void {
    defer self.release();
    const previous_log = n.logging.bind(&self.logs);
    defer _ = n.logging.bind(previous_log);
    const failure: ?anyerror = blk: {
        serve(self) catch |err| break :blk err;
        break :blk null;
    };
    finishCheckpoint(self, failure == null);
    self.finishOwner(failure);
}

fn loadRemembered(self: *Runtime, io: std.Io) []const n.peers.remembered.Record {
    const owner = self.owner.?;
    const app = &owner.application;
    if (app.peer_store_dir_len == 0) return &.{};
    owner.checkpoint = n.peers.RememberedCheckpoint.init(io, app.peer_store_dir[0..app.peer_store_dir_len], &app.genesis_root) catch |err| {
        std.log.scoped(.network_peers).warn("remembered_persistence_disabled reason={s}", .{@errorName(err)});
        return &.{};
    };
    const checkpoint = &owner.checkpoint.?;
    const loaded = n.peers.remembered_file.read(io, checkpoint.dir, &checkpoint.root, &checkpoint.records) catch |err| {
        if (err != error.FileNotFound) std.log.scoped(.network_peers).info("remembered_file_ignored reason={s}", .{@errorName(err)});
        return &.{};
    };
    std.log.scoped(.network_peers).info("remembered_file_loaded records={d} skipped={d}", .{ loaded.count, loaded.skipped });
    return checkpoint.records[0..loaded.count];
}

fn collectCheckpoint(self: *Runtime, io: std.Io) void {
    if (self.owner.?.checkpoint) |*checkpoint| {
        _ = checkpoint.collect(io) catch |err| {
            std.log.scoped(.network_peers).warn("remembered_checkpoint_failed reason={s}", .{@errorName(err)});
        };
    }
}

fn startCheckpoint(self: *Runtime, io: std.Io, now: n.Now) void {
    const checkpoint = if (self.owner.?.checkpoint) |*value| value else return;
    if (checkpoint.future != null) {
        std.log.scoped(.network_peers).debug("remembered_checkpoint_skipped reason=busy", .{});
        return;
    }
    var records: [n.peers.remembered.capacity]n.peers.remembered.Record = undefined;
    const count = self.owner.?.core.rememberedPeers(now, &records) catch unreachable;
    _ = checkpoint.start(io, records[0..count]) catch |err| {
        std.log.scoped(.network_peers).warn("remembered_checkpoint_skipped reason={s}", .{@errorName(err)});
    };
}

fn finishCheckpoint(self: *Runtime, succeeded: bool) void {
    const owner = self.owner.?;
    if (owner.checkpoint) |*checkpoint| {
        const io = owner.threaded.io();
        self.lock();
        const graceful = succeeded and self.bridge.graceful and self.bridge.reason == .requested and self.bridge.env_alive;
        self.unlock();
        // Join outside the runtime mutex. A stalled filesystem may outlast the Goodbye deadline.
        checkpoint.finish(io, if (graceful) n.time.optionalMilliseconds(self.closing_deadline) else null) catch |err| {
            if (err != error.Canceled) std.log.scoped(.network_peers).warn("remembered_checkpoint_failed reason={s}", .{@errorName(err)});
        };
        checkpoint.deinit(io);
        owner.checkpoint = null;
    }
}

fn serve(self: *Runtime) !void {
    std.debug.assert(self.owner.?.core_live);
    const io = self.owner.?.threaded.io();
    var ingress: gossip_mod.Ingress = .{ .runtime = self, .io = io };
    const sink = ingress.sink();
    self.owner.?.core.protocols.gossipsub.message_sink = &sink;
    defer self.owner.?.core.protocols.gossipsub.message_sink = null;
    var host: Host = .{ .runtime = self, .io = io };
    while (try turn(self, io, &host, &ingress)) |result| {
        if (result.cancelled) return error.Canceled;
    }
}

/// One owner turn: the stop check, then one core step that applies host work after its readiness
/// poll, then the turn's application events, connect completions and publication. Returns null
/// once the owner stops.
fn turn(self: *Runtime, io: std.Io, host: *Host, ingress: *const gossip_mod.Ingress) !?n.NetworkCore.Result {
    self.lock();
    const stop = self.bridge.stop;
    const graceful = self.bridge.graceful and self.bridge.reason == .requested;
    self.unlock();
    if (stop and !graceful) return null;
    const timestamp = try Now.read(io);
    collectCheckpoint(self, io);
    if (stop) {
        if (self.closing_deadline == null) {
            std.log.scoped(.network_runtime).info("owner_stopping mode=graceful peers={d}", .{self.owner.?.core.peerCounts().connected});
            self.lock();
            self.cancelCommandsLocked();
            self.bridge.publications.?.close(self.bridge.terminal_error orelse error.NetworkClosed);
            self.notifyIfReadyLocked();
            self.unlock();
            self.closing_deadline = timestamp.millis() +| 2000;
            startCheckpoint(self, io, timestamp);
            self.owner.?.core.beginGracefulClose(timestamp);
        }
        if (timestamp.millis() >= self.closing_deadline.? or self.owner.?.core.peerCounts().connected == 0) return null;
    } else if (self.owner.?.checkpoint != null and timestamp.millis() >= self.owner.?.remembered_due_ms) {
        self.owner.?.remembered_due_ms = timestamp.millis() +| n.peers.RememberedCheckpoint.interval_ms;
        startCheckpoint(self, io, timestamp);
    }
    self.lock();
    const peer_room: usize = if (self.bridge.peer_updates) |lane| 64 - @as(usize, lane.len) else self.owner.?.outputs.len;
    const deadline = hostDeadline(self, timestamp) catch |err| {
        self.unlock();
        return err;
    };
    self.unlock();
    const result = n.driver.step(&self.owner.?.core, io, timestamp, .{ .peers = self.owner.?.outputs[0..@min(peer_room, self.owner.?.outputs.len)], .application = &self.owner.?.application_outputs }, .{ .handler = .{ .context = host, .apply = Host.apply }, .deadline = n.time.optionalMilliseconds(deadline) });
    if (host.failure) |err| return err;
    if (ingress.failure) |err| return err;
    // The step's clock was read after its poll, so deadlines that ended the wait are due.
    const tick = result.transport.now;
    try requests_mod.capture(self, self.owner.?.application_outputs[0..result.counts.application], tick);
    commands.completeConnects(self, result.transport_events, tick);
    publishIdentity(self);
    publishTurn(self, &result);
    return result;
}

/// The earliest host-owned deadline, read under the lock: the slot clock, peer checkpoint, connect timeouts, graceful close and gossip processor expiry. Host work
/// found by the previous turn's event capture is due now.
fn hostDeadline(self: *Runtime, timestamp: n.Now) !u64 {
    if (self.host_due) return timestamp.millis();
    var deadline: u64 = std.math.maxInt(u64);
    if (!self.bridge.stop and self.owner.?.checkpoint != null) deadline = @min(deadline, self.owner.?.remembered_due_ms);
    if (!self.bridge.stop) if (self.owner.?.state) |*state| {
        if (try self.owner.?.core.clock.read(timestamp) != state.applied_slot) return timestamp.millis();
        deadline = @min(deadline, n.time.ceilMilliseconds(try self.owner.?.core.clock.deadline(timestamp)));
    };
    if (commands.connectDeadline(&self.bridge.commands)) |value| deadline = @min(deadline, value);
    if (self.closing_deadline) |value| deadline = @min(deadline, value);
    if (self.bridge.gossip) |*table| if (table.deadline()) |value| {
        deadline = @min(deadline, value);
    };
    return deadline;
}

/// The core's host seam for this owner.
const Host = struct {
    runtime: *Runtime,
    io: std.Io,
    failure: ?anyerror = null,

    fn apply(context: *anyopaque, core: *n.NetworkCore, tick: n.Now) n.NetworkCore.HostProgress {
        const self: *Host = @ptrCast(@alignCast(context));
        std.debug.assert(core == &self.runtime.owner.?.core);
        if (self.failure != null) return .{};
        return applyWork(self.runtime, self.io, tick) catch |err| {
            self.failure = err;
            return .{};
        };
    }
};

/// Drains the wake pipe before reading any queue, so a submission that lands after the drain
/// wakes the next poll. Then applies reports, commands, publications and requests in admission
/// order, gossip verdicts and processor maintenance, and pending request and response actions.
fn applyWork(self: *Runtime, io: std.Io, tick: n.Now) !n.NetworkCore.HostProgress {
    self.lock();
    self.bridge.wake.?.drain() catch self.failLocked(error.NetworkWakeFailed);
    self.host_due = false;
    const stop = self.bridge.stop;
    const stopped = self.bridge.stop and !(self.bridge.graceful and self.bridge.reason == .requested);
    self.unlock();
    if (stopped) return .{};
    var more = false;
    if (!stop) {
        if (self.owner.?.state) |*state| try state.advance(&self.owner.?.core, &self.owner.?.config.chain, tick);
        more = applyReports(self, tick) or more;
        more = try executeWork(self, io, tick) or more;
    }
    more = try gossip_mod.maintain(self, io, tick) or more;
    requests_mod.applyPending(self, tick);
    more = try incoming_mod.applyPending(self, tick) or more;
    return .{ .runnable = more };
}

/// Applies up to 32 queued peer reports. Returns whether more remain.
fn applyReports(self: *Runtime, tick: n.Now) bool {
    for (0..32) |_| {
        self.lock();
        const report = self.bridge.reports.next();
        if (report) |item| if (item.action == .fatal) {
            if (self.bridge.gossip) |*table| table.dropPeer(&item.identity);
        };
        self.unlock();
        const item = report orelse return false;
        if (self.owner.?.core.reportPeer(&item, tick) == null) {
            self.lock();
            self.bridge.reports.ignored +|= 1;
            self.unlock();
        }
    }
    self.lock();
    defer self.unlock();
    return self.bridge.reports.pending != 0;
}

/// Executes ready commands, publications and requests in admission order under their per-turn caps.
/// Diagnostics wait for the shared result buffer. Returns whether a cap stopped work that can continue.
fn executeWork(self: *Runtime, io: std.Io, tick: n.Now) !bool {
    var controls: usize = 0;
    var requests: usize = 0;
    var publishes: usize = 0;
    var bytes: usize = 0;
    for (0..commands.turn_max + publications.turn_max + requests_mod.turn_max) |_| {
        self.lock();
        if (self.bridge.stop) {
            self.unlock();
            return false;
        }
        const command = self.bridge.commands.nextQueued();
        const publication = self.bridge.publications.?.oldest();
        const request = self.bridge.requests.?.oldest();
        const control_order = if (command) |token| self.bridge.commands.get(token).order else std.math.maxInt(u64);
        const publish_order = if (publication) |token| self.bridge.publications.?.get(token).?.order else std.math.maxInt(u64);
        const request_order = if (request) |token| self.bridge.requests.?.get(token).?.order else std.math.maxInt(u64);
        const order = @min(control_order, publish_order, request_order);
        if (order == std.math.maxInt(u64)) {
            self.unlock();
            return false;
        }
        if (order == control_order) {
            if (controls == commands.turn_max) {
                self.unlock();
                return true;
            }
            const cell = self.bridge.commands.get(command.?);
            self.bridge.commands.transition(cell, .executing);
            self.unlock();
            commands.execute(self, command.?, tick);
            controls += 1;
        } else if (order == publish_order) {
            const len = self.bridge.publications.?.get(publication.?).?.payload.len;
            if (publishes == publications.turn_max or (publishes != 0 and len > publications.turn_bytes -| bytes)) {
                self.unlock();
                return true;
            }
            self.unlock();
            publications.execute(self, publication.?, tick, (try Now.read(io)).millis());
            publishes += 1;
            bytes += len;
        } else {
            if (requests == requests_mod.turn_max) {
                self.unlock();
                return true;
            }
            self.unlock();
            try requests_mod.submit(self, request.?, tick);
            requests += 1;
        }
    }
    return true;
}

pub fn publishIdentity(self: *Runtime) void {
    const owner = self.owner.?;
    if (owner.identity_revision == owner.core.local_revision) return;
    const identity = owner.readIdentity() catch |err| {
        std.log.scoped(.network_runtime).warn("identity_publish_failed reason={s}", .{@errorName(err)});
        return;
    };
    self.lock();
    defer self.unlock();
    self.bridge.identity = identity;
    owner.identity_revision = owner.core.local_revision;
    self.notifyIfReadyLocked();
}

fn publishTurn(self: *Runtime, result: *const n.NetworkCore.Result) void {
    self.lock();
    self.refreshRequestCapacityLocked();
    if (self.bridge.peer_updates) |lane| lane.publish(self.owner.?.outputs[0..result.counts.peers]);
    self.notifyIfReadyLocked();
    if (result.failure) |err| {
        std.log.scoped(.network_runtime).debug("owner_turn_failed reason={s} fatal={any}", .{ @errorName(err), result.readiness.failure != null });
        self.operational_failures +|= 1;
        if (result.readiness.failure != null) self.failLocked(err);
    }
    self.owner_turns +|= 1;
    self.unlock();
}

pub fn renderMetrics(self: *Runtime, timestamp: n.Now) void {
    var context = n.metrics.Context.init(&self.owner.?.core, timestamp);
    // On-demand scrapes share one buffer with JS readers; rendering holds the mutex and can delay a JS turn.
    self.lock();
    if (self.bridge.gossip) |*table| {
        const state = table.snapshot(timestamp.millis());
        context.expired_executing = state.expiredExecuting;
    }
    self.captureProcessorLocked(&self.owner.?.processor_metrics);
    defer self.unlock();
    context.processor = &self.owner.?.processor_metrics;
    self.metrics.render(&context);
}

test "a command queued after wait planning executes in the turn whose poll observes the wake" {
    if (!n.NetworkCore.wait.supported) return error.SkipZigTest;
    const testing = std.testing.allocator;
    var runtime: Runtime = .{ .env = undefined, .bridge = .{ .notify_live = false, .env_alive = false } };
    const owner = try testing.create(Owner);
    defer testing.destroy(owner);
    owner.* = .{};
    owner.threaded = std.Io.Threaded.init(testing, .{ .async_limit = .nothing, .concurrent_limit = .nothing });
    defer owner.threaded.deinit();
    const io = owner.threaded.io();
    runtime.owner = owner;
    const key = try n.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{71}));
    const beacon_config = @import("config");
    const chain_base = if (@import("preset").active_preset == .minimal) beacon_config.minimal.chain_config else beacon_config.mainnet.chain_config;
    const beacon = beacon_config.BeaconConfig.init(chain_base, @splat(0));
    owner.config.chain = try n.chain.Config.init(&beacon, false);
    const initial = try owner.config.chain.update(.{ .metadata = .{ .custody_group_count = 1 }, .status = .{ .earliest_available_slot = 0 } }, null, 0);
    const resolved = try n.configuration.resolve(.{
        .seed = 1,
        .limits = .{ .connections_max = 4, .handshaking_max = 4, .dialing_max = 1 },
        .peers = .{ .capacity = 4, .outbound_reserve = 1, .max_peers = 3, .target_peers = 2, .min_outbound = 1 },
        .dial = .{ .capacity = 4, .concurrent_max = 1, .outbound_reserved = 1, .seed = 7 },
        .gossip = .{ .topic_policy = owner.config.chain.topics[0..owner.config.chain.boundary_count], .mcache_capacity = 8, .validation_capacity = 2 },
        .forks = owner.config.chain.forks[0..owner.config.chain.boundary_count],
        .router = .{ .capabilities = initial.capabilities },
        .admission_policy = .{ .deneb_start_slot = 0, .blocks_pre_deneb = 1024, .blocks_deneb = 128, .blob_identifiers_deneb = 768, .blob_identifiers_electra = 1152, .number_of_columns = 128, .column_chunks = 16384, .blob_schedule = &.{.{ .start_slot = 0, .max_blobs = 6 }} },
    });
    try owner.core.init(testing, io, &resolved, .{
        .clock = try n.SlotClock.init(&beacon.chain, 1000),
        .host = &key,
        .bind = .{ .ip4 = .loopback(0) },
        .local = initial.local,
        .schedule = initial.schedule,
    });
    defer owner.core.deinit(io);
    runtime.bridge.wake = try network_wake.Wake.init();
    defer runtime.bridge.wake.?.deinit();
    try owner.core.setHostWake(runtime.bridge.wake.?.read_fd);
    runtime.bridge.payload_budget.limit = 1 << 20;
    runtime.bridge.publications = try publications.Table.init(testing, 1, &runtime.bridge.payload_budget, 12_000);
    defer runtime.bridge.publications.?.deinit();
    runtime.bridge.requests = try requests_mod.Table.init(testing, 1, &runtime.bridge.payload_budget);
    defer runtime.bridge.requests.?.deinit();
    var host: Host = .{ .runtime = &runtime, .io = io };
    const ingress: gossip_mod.Ingress = .{ .runtime = &runtime, .io = io };
    // The first turns write the health log, then only deadlines remain.
    for (0..4) |_| _ = (try turn(&runtime, io, &host, &ingress)).?;

    const SubmitAtPoll = struct {
        threadlocal var target: ?*Runtime = null;
        threadlocal var token: ?commands.Token = null;
        threadlocal var failure: ?anyerror = null;
        threadlocal var base: std.Io = undefined;

        fn checkCancel(userdata: ?*anyopaque) std.Io.Cancelable!void {
            // The native wait checks cancellation after planning and before polling.
            if (target) |pending| {
                target = null;
                token = pending.reserveCommand(.reStatusPeers, null) catch |err| {
                    failure = err;
                    return error.Canceled;
                };
                pending.bridge.commands.get(token.?).input.reStatusPeers.count = 0;
                pending.queueCommand(token.?) catch |err| {
                    failure = err;
                    return error.Canceled;
                };
            }
            return base.vtable.checkCancel(userdata);
        }
    };
    SubmitAtPoll.target = &runtime;
    defer SubmitAtPoll.target = null;
    SubmitAtPoll.token = null;
    SubmitAtPoll.failure = null;
    SubmitAtPoll.base = io;
    var vtable = io.vtable.*;
    vtable.checkCancel = SubmitAtPoll.checkCancel;
    const poll_io: std.Io = .{ .userdata = io.userdata, .vtable = &vtable };
    const result = (try turn(&runtime, poll_io, &host, &ingress)).?;
    try std.testing.expect(SubmitAtPoll.target == null);
    try std.testing.expect(SubmitAtPoll.failure == null);
    try std.testing.expect(result.failure == null);
    try std.testing.expect(result.readiness.host);
    const token = SubmitAtPoll.token orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(.terminal, runtime.bridge.commands.get(token).state);
    try std.testing.expect(runtime.bridge.commands.get(token).failure == null);
    runtime.retireCommand(token);
    const state_config = try n.application_state.Config.init(&beacon.chain, .{});
    owner.core.clock = try n.SlotClock.init(&beacon.chain, 1000);
    owner.state = try n.application_state.State.init(&state_config, &owner.config.chain, &owner.core.peerId(), &initial.local);
    const first_slot = n.Now.fromMilliseconds(.{ .mono_ms = result.transport.now.millis() + 1, .unix_s = 1000 });
    _ = try applyWork(&runtime, io, first_slot);
    try std.testing.expectEqual(first_slot.millis() + 1000, try hostDeadline(&runtime, first_slot));
    const duration = beacon.chain.SLOT_DURATION_MS;
    const next_slot = n.Now.fromMilliseconds(.{ .mono_ms = first_slot.millis() + duration, .unix_s = 1000 + @as(i64, @intCast(duration / 1000)) });
    try std.testing.expectEqual(next_slot.millis(), try hostDeadline(&runtime, next_slot));
    _ = try applyWork(&runtime, io, next_slot);
    try std.testing.expectEqual(1, try owner.core.clock.read(next_slot));
    try std.testing.expectEqual(1, owner.state.?.applied_slot.?);
    const statuses = [_]u64{ 120, 80, 90 };
    var updates: [3]commands.Token = undefined;
    for (&updates, statuses, 0..) |*update_token, head, i| {
        update_token.* = try runtime.bridge.commands.reserve(if (i == 1) .applyIntent else .updateStatus);
        const cell = runtime.bridge.commands.get(update_token.*);
        var status = owner.core.localState().status;
        status.head_slot = head;
        if (i == 1) cell.input.applyIntent = .{ .status = status } else cell.input.updateStatus = status;
        runtime.bridge.commands.transition(cell, .queued);
    }
    defer for (updates) |update| runtime.bridge.commands.retire(update);
    try std.testing.expect(!try executeWork(&runtime, io, next_slot));
    for (updates) |update| {
        const cell = runtime.bridge.commands.get(update);
        try std.testing.expectEqual(.terminal, cell.state);
        try std.testing.expect(cell.failure == null);
    }
    try std.testing.expectEqual(@as(u64, 90), owner.core.localState().status.head_slot);
    runtime.owner = null;
}

test "queued request and disconnect share the protocol turn clock while latency uses execution time" {
    const testing = std.testing.allocator;
    var runtime: Runtime = .{ .env = undefined, .bridge = .{ .notify_live = false, .env_alive = false } };
    const owner = try testing.create(Owner);
    defer testing.destroy(owner);
    owner.* = .{};
    runtime.owner = owner;
    const key = try n.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{71}));
    const resolved = try n.configuration.resolve(.{
        .seed = 1,
        .gossip = .{ .topic_policy = &test_support.topic_policy },
        .forks = &.{.{ .digest = @splat(0), .fork = .phase0 }},
        .admission_policy = .{ .deneb_start_slot = 0, .blocks_pre_deneb = 1024, .blocks_deneb = 128, .blob_identifiers_deneb = 768, .blob_identifiers_electra = 1152, .number_of_columns = 128, .column_chunks = 16384, .blob_schedule = &.{.{ .start_slot = 0, .max_blobs = 6 }} },
    });
    try owner.core.init(testing, std.testing.io, &resolved, .{
        .clock = try n.SlotClock.init(&config.mainnet.chain_config, 0),
        .host = &key,
        .bind = .{ .ip4 = .loopback(0) },
        .local = .{ .metadata = .{ .custody_group_count = 1 }, .status = .{ .earliest_available_slot = 0 } },
    });
    defer owner.core.deinit(std.testing.io);
    const remote_key = try n.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{73}));
    var remote: n.Transport = .{};
    try remote.init(testing, std.testing.io, .{ .host = &remote_key, .bind = .{ .ip4 = .loopback(0) } });
    defer remote.deinit(std.testing.io);
    const remote_id = remote.peerId();
    _ = try owner.core.transport.dialPeer(std.testing.io, remote.localAddress(), remote_id, try n.Now.read(std.testing.io));
    for (0..64) |_| {
        var events: [32]n.Engine.Event = undefined;
        const progress = n.transport_driver.step(&owner.core.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(0) });
        if (progress.failure) |err| return err;
        for (events[0..progress.progress.events]) |event| if (event == .connected) {
            owner.core.peer_manager.transportProgress(&owner.core.transport.engine);
            try std.testing.expect(owner.core.peer_manager.admit(&event.connected, remote.localAddress(), &.{ .reqresp = &owner.core.protocols.reqresp, .router = &owner.core.protocols.router, .engine = &owner.core.transport.engine }, progress.progress.now) != null);
        };
        if (owner.core.isConnected(&remote_id)) break;
        const reply = n.transport_driver.step(&remote, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(0) });
        if (reply.failure) |err| return err;
    }
    try std.testing.expect(owner.core.isConnected(&remote_id));
    const tick = try n.Now.read(std.testing.io);
    const Clock = struct {
        var time: n.Now = undefined;
        fn read(_: ?*anyopaque, clock: std.Io.Clock) std.Io.Timestamp {
            return .{ .nanoseconds = if (clock == .real) @as(i96, time.unixSeconds()) * std.time.ns_per_s else @as(i96, time.millis()) * std.time.ns_per_ms };
        }
    };
    Clock.time = Now.fromMilliseconds(.{ .mono_ms = tick.millis() + 100, .unix_s = tick.unixSeconds() });
    var vtable = std.testing.io.vtable.*;
    vtable.now = Clock.read;
    const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
    runtime.bridge.payload_budget.limit = 64 << 20;
    runtime.bridge.publications = try publications.Table.init(testing, 1, &runtime.bridge.payload_budget, 12_000);
    defer runtime.bridge.publications.?.deinit();
    runtime.bridge.requests = try requests_mod.Table.init(testing, 1, &runtime.bridge.payload_budget);
    defer runtime.bridge.requests.?.deinit();

    const peer_key = try n.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{72}));
    const connect = try runtime.bridge.commands.reserve(.connect);
    defer runtime.bridge.commands.retire(connect);
    const command = runtime.bridge.commands.get(connect);
    command.input.connect.peer = n.PeerId.fromPublicKey(&peer_key.publicKey());
    command.input.connect.addresses[0] = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9000 } };
    command.input.connect.address_count = 1;
    command.input.connect.timeout_ms = 1000;
    runtime.bridge.commands.transition(command, .queued);

    const publication = try runtime.bridge.publications.?.reserve(.beacon_block, 0);
    defer runtime.bridge.publications.?.retire(publication);
    const cell = runtime.bridge.publications.?.get(publication).?;
    cell.order = try runtime.bridge.commands.nextOrder();
    cell.queued_ms = tick.millis() + 50;
    runtime.bridge.publications.?.transition(cell, .queued);

    const request = try runtime.bridge.requests.?.reserve(.blocks_by_root_v2, 32);
    defer {
        owner.core.deinit(io);
        requests_mod.closeLocked(&runtime);
        runtime.bridge.requests.?.retire(request);
    }
    try runtime.bridge.requests.?.allocate(request, 32);
    const request_cell = runtime.bridge.requests.?.get(request).?;
    request_cell.peer = remote_id;
    @memset(request_cell.input, 0);
    request_cell.order = try runtime.bridge.commands.nextOrder();
    request_cell.state = .queued;
    runtime.bridge.requests.?.refresh(request_cell);

    const disconnect = try runtime.bridge.commands.reserve(.disconnect);
    defer runtime.bridge.commands.retire(disconnect);
    runtime.bridge.commands.get(disconnect).input.disconnect = remote_id;
    runtime.bridge.commands.transition(runtime.bridge.commands.get(disconnect), .queued);
    try std.testing.expect(!try executeWork(&runtime, io, tick));
    try std.testing.expect(command.failure == null);
    try std.testing.expectEqual(tick.millis() + 1000, command.deadline);
    try std.testing.expectEqual(error.UnknownTopic, cell.failure.?);
    try std.testing.expectEqual(tick.millis(), owner.core.protocols.gossipsub.last_now_ms);
    try std.testing.expectEqual(@as(u128, 50), runtime.bridge.publications.?.latency.sum);
    try std.testing.expect(runtime.bridge.commands.get(disconnect).failure == null);
    try std.testing.expect(!owner.core.isConnected(&remote_id));
    try std.testing.expect(request_cell.native != null);

    const counts = owner.core.protocols.process(&owner.core.transport.engine, &.{}, tick, .{ .application = &owner.application_outputs });
    try requests_mod.capture(&runtime, owner.application_outputs[0..counts.application], tick);
    try std.testing.expectEqual(@as(usize, 1), counts.application);
    try std.testing.expectEqual(requests_mod.State.terminal, request_cell.state);
    try std.testing.expectEqual(n.reqresp.ReqResp.Failure{ .negotiation_failed = .stream_closed }, request_cell.terminal.?.failed.reason);
    const counters = &owner.core.protocols.reqresp.protocol_counters[@intFromEnum(n.reqresp.Protocol.blocks_by_root_v2)];
    try std.testing.expectEqual(@as(u64, 1), counters.outgoing_time.count);
    try std.testing.expectEqual(@as(u128, 0), counters.outgoing_time.sum);
}
