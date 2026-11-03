const std = @import("std");
const zapi = @import("zapi:zapi");
const js = zapi.js;
const BeaconConfig = @import("BeaconConfig.zig");
const AddonIdentity = @import("zapi_addon_identity");
const napi = zapi.napi;
const r = @import("network_runtime.zig");
const Runtime = r.Runtime;
const Value = napi.Value;
const decode = @import("network_js_input.zig");
const gossip = @import("network_gossip.zig");
const publication_js = @import("network_publication_js.zig");
const incoming_js = @import("network_incoming_js.zig");
const request_js = @import("network_request_js.zig");
const exchange_mod = @import("network_exchange.zig");
const exchange_js = @import("network_exchange_js.zig");
const feedback = @import("network_feedback.zig");
const command_js = @import("network_command_js.zig");
const network_owner = @import("network_owner.zig");
const network_storage = @import("network_storage.zig");
const network_wake = @import("network_wake.zig");
const network = @import("network");
const Promise = @import("network_promise.zig");
const network_logs = @import("network_logs.zig");

const application_cfg = @import("network_application_config.zig");

pub const js_meta = js.class(.{});

runtime: ?*Runtime = null,
stopped: bool = false,

pub fn init() @This() {
    return .{};
}

pub fn initialize(self: *@This(), config: js.Value, callback: js.Value) !js.Value {
    if (self.stopped) return error.NetworkClosed;
    if (try callback.val.typeof() != .function) return error.InvalidNetworkConfig;
    const runtime = try r.create(js.env());
    errdefer runtime.release();
    errdefer runtime.disposeJsReferences();
    runtime.owner = try r.allocator.create(r.Owner);
    runtime.owner.?.* = .{};
    const beacon_value = try decode.get(config.val, "beaconConfig");
    if (try beacon_value.typeof() != .object) return error.TypeMismatch;
    const beacon_config = try js.convertArg(*const BeaconConfig, AddonIdentity, beacon_value.value, beacon_value.env);
    try application_cfg.parse(config.val, &beacon_config.config_rc.instance.config, &runtime.owner.?.config, &runtime.owner.?.application);
    runtime.logs.configure(runtime.owner.?.application.log_level);
    try network_owner.prepareConfiguration(runtime);
    try network_storage.initialize(runtime, &runtime.owner.?.application);
    runtime.bridge.wake = try network_wake.Wake.init();
    errdefer {
        if (runtime.owner.?.core_live) runtime.owner.?.core.setHostWake(null) catch unreachable;
        if (runtime.bridge.wake) |*wake| wake.deinit();
        runtime.bridge.wake = null;
    }
    try network_owner.initialize(runtime);
    const identity = try runtime.owner.?.readIdentity();
    runtime.owner.?.identity_revision = runtime.owner.?.core.local_revision;

    const env = js.env();
    const name = try env.createStringUtf8("NativeNetworkRuntime");
    runtime.bridge.notify = try r.Notify.create(env, callback.val, null, name, 1, 1, runtime, Runtime.finalize, onNotify);
    runtime.retain();
    errdefer runtime.bridge.notify.release(.abort) catch unreachable;
    try env.addEnvCleanupHook(Runtime, runtime, Runtime.cleanup);
    runtime.hook_live = true;
    runtime.retain();
    errdefer runtime.removeHook();
    const holder = try env.createObject();
    try holder.setNamedProperty("identity", try command_js.identity(env, &identity));
    try holder.setNamedProperty("limits", try resolvedLimits(env, runtime));
    const closed = try runtime.closed.init(env);
    try holder.setNamedProperty("closed", closed);
    runtime.retain();
    errdefer runtime.release();
    runtime.thread = try std.Thread.spawn(.{ .stack_size = std.Thread.SpawnConfig.default_stack_size }, network_owner.run, .{runtime});
    runtime.thread.?.setName(std.Io.Threaded.global_single_threaded.io(), "network-owner") catch |err| {
        std.log.scoped(.network_runtime).debug("owner_thread_name_failed reason={s}", .{@errorName(err)});
    };
    self.runtime = runtime;
    return .{ .val = holder };
}

/// The JS wrapper retains this object through close; environment cleanup joins the owner before finalization.
pub fn deinit(self: *@This()) void {
    if (self.runtime) |runtime| {
        std.debug.assert(runtime.bridge.quiescent and runtime.thread == null);
        std.debug.assert(!runtime.hook_live and runtime.closed.resolvers == null);
        runtime.release();
        self.runtime = null;
    }
}

fn onNotify(env: napi.Env, callback: Value, runtime: *Runtime, _: *void) void {
    // Only an environment that stopped running JavaScript fails the notification's own N-API calls.
    notify(env, callback, runtime) catch runtime.forceStop();
}

/// Node may disable JavaScript before running environment cleanup hooks.
fn jsStopped(err: anyerror) bool {
    return err == error.Closing or err == error.CannotRunJS or err == error.PendingException;
}

/// The notification callback only schedules: the host runs an exchange, which arms again once nothing is queued.
fn notify(env: napi.Env, callback: Value, runtime: *Runtime) !void {
    runtime.lock();
    const alive = runtime.bridge.env_alive;
    runtime.unlock();
    if (!alive) return;
    _ = env.callFunction(callback, try env.getUndefined(), .{}) catch {
        // A throwing host may not have scheduled an exchange, so owner activity can notify again.
        runtime.lock();
        runtime.bridge.notification_armed = true;
        runtime.unlock();
    };
}

/// Settles native Promises and pulls a bounded batch under standing host capacity. See network_exchange.zig for borrow contracts.
pub fn exchange(self: *@This()) !js.Value {
    const runtime = try self.owner();
    runtime.retain();
    defer runtime.release();
    if (runtime.in_exchange) return error.NetworkExchangeReentered;
    runtime.in_exchange = true;
    defer runtime.in_exchange = false;
    var host: Exchange = .{ .env = js.env(), .runtime = runtime };
    const now = try gossip.monotonic();
    const result = exchange_mod.run(runtime, now, &host) catch |err| {
        if (jsStopped(err)) runtime.forceStop();
        return err;
    };
    return .{ .val = result };
}

/// Updates the remaining host allowance without notifying JS; the caller drives exchange when capacity recovers.
pub fn setCapacity(self: *@This(), value: js.Value) !void {
    const runtime = try self.owner();
    const capacity = try feedback.capacity(value.val);
    runtime.lock();
    defer runtime.unlock();
    runtime.bridge.capacity = capacity;
}

pub fn reportGossip(self: *@This(), handle: js.Value, verdict_value: js.Value) !void {
    const runtime = try self.owner();
    const token = try feedback.handle(handle.val);
    const verdict = try feedback.name(network.gossipsub.Gossipsub.Verdict, verdict_value.val, error.InvalidGossipVerdict);
    const now = try gossip.monotonic();
    runtime.lock();
    defer runtime.unlock();
    if (runtime.bridge.stop) return;
    if (runtime.bridge.gossip) |*table| _ = table.report(token, verdict, now);
    runtime.wakeOwnerLocked();
}

pub fn classifyGossip(self: *@This(), handle: js.Value, available_value: js.Value) !void {
    const runtime = try self.owner();
    const token = try feedback.handle(handle.val);
    const available = try decode.boolean(available_value.val);
    runtime.lock();
    defer runtime.unlock();
    if (runtime.bridge.stop) return;
    if (runtime.bridge.gossip) |*table| _ = table.classify(token, available);
    runtime.wakeOwnerLocked();
    runtime.notifyIfReadyLocked();
}

pub fn notifyBlock(self: *@This(), value: js.Value) !void {
    const runtime = try self.owner();
    const root = try decode.fixed(32, value.val);
    runtime.lock();
    defer runtime.unlock();
    if (runtime.bridge.stop) return;
    if (runtime.bridge.gossip) |*table| table.notifyBlock(root);
    runtime.wakeOwnerLocked();
}

pub fn dropQueuedGossip(self: *@This()) !void {
    const runtime = try self.owner();
    runtime.lock();
    defer runtime.unlock();
    if (runtime.bridge.stop) return;
    if (runtime.bridge.gossip) |*table| table.dropQueued();
    runtime.wakeOwnerLocked();
}

pub fn reportPeer(self: *@This(), peer: js.Value, action: js.Value, context: js.Value) !void {
    const runtime = try self.owner();
    const report = try feedback.peerReport(peer.val, action.val, context.val);
    runtime.lock();
    defer runtime.unlock();
    if (runtime.bridge.stop) return;
    runtime.bridge.reports.addCount(&report, 1);
    runtime.wakeOwnerLocked();
}

const Exchange = exchange_js.Host;

fn owner(self: *@This()) !*Runtime {
    return self.runtime orelse error.NetworkClosed;
}

pub fn close(self: *@This()) void {
    self.stopped = true;
    if (self.runtime) |runtime| {
        runtime.lock();
        runtime.bridge.graceful = runtime.bridge.env_alive;
        runtime.unlock();
        runtime.requestStop();
    }
}

/// Resolved native capacities and publication lifetime.
fn resolvedLimits(env: napi.Env, runtime: *const Runtime) !Value {
    const object = try env.createObject();
    try object.setNamedProperty("peerCapacity", try env.createUint32(runtime.peer_capacity));
    try object.setNamedProperty("incomingCapacity", try env.createUint32(@intCast(runtime.bridge.incoming.?.diag.capacity)));
    try object.setNamedProperty("publicationMaxWaitMs", try env.createDouble(@floatFromInt(runtime.bridge.publications.?.max_wait_ms)));
    return object;
}

/// The gossip SHA-256 implementation this process selected, for packaged qualification records.
pub fn gossipSha256Backend() js.String {
    return js.String.from(@tagName(network.gossipsub.sha256.backend()));
}

pub fn getMetrics(self: *@This()) !js.Value {
    return .{ .val = try command_js.submit(js.env(), try self.owner(), .getMetrics, &.{}) };
}

pub fn drainLogs(self: *@This(), limit: js.Value) !js.Value {
    return network_logs.drain(try self.owner(), limit.val);
}

pub fn setLogLevel(self: *@This(), level: js.Value) !void {
    try network_logs.configure(try self.owner(), level.val);
}

pub fn applyIntent(self: *@This(), intent: js.Value) !js.Value {
    return .{ .val = try command_js.submit(js.env(), try self.owner(), .applyIntent, &.{intent.val}) };
}
pub fn updateStatus(self: *@This(), status: js.Value) !js.Value {
    return .{ .val = try command_js.submit(js.env(), try self.owner(), .updateStatus, &.{status.val}) };
}
pub fn getPeerScores(self: *@This()) !js.Value {
    return .{ .val = try command_js.submit(js.env(), try self.owner(), .getPeerScores, &.{}) };
}
pub fn getGossipDiagnostics(self: *@This(), cursor: js.Value) !js.Value {
    return .{ .val = try command_js.submit(js.env(), try self.owner(), .getGossipDiagnostics, &.{cursor.val}) };
}
pub fn connect(self: *@This(), peer: js.Value, addresses: js.Value, timeout: js.Value) !js.Value {
    return .{ .val = try command_js.submit(js.env(), try self.owner(), .connect, &.{ peer.val, addresses.val, timeout.val }) };
}
pub fn disconnect(self: *@This(), peer: js.Value) !js.Value {
    return .{ .val = try command_js.submit(js.env(), try self.owner(), .disconnect, &.{peer.val}) };
}
pub fn reStatusPeers(self: *@This(), peers: js.Value) !js.Value {
    return .{ .val = try command_js.submit(js.env(), try self.owner(), .reStatusPeers, &.{peers.val}) };
}
pub fn addDirectPeer(self: *@This(), peer: js.Value, addresses: js.Value) !js.Value {
    return .{ .val = try command_js.submit(js.env(), try self.owner(), .addDirectPeer, &.{ peer.val, addresses.val }) };
}
pub fn removeDirectPeer(self: *@This(), peer: js.Value) !js.Value {
    return .{ .val = try command_js.submit(js.env(), try self.owner(), .removeDirectPeer, &.{peer.val}) };
}

pub fn commandCapacityWatch(self: *@This(), token: js.Value) !js.Value {
    return .{ .val = try js.env().getBoolean(try @import("network_capacity_js.zig").watch(try self.owner(), token.val)) };
}

pub fn requestStart(self: *@This(), peer: js.Value, protocol: js.Value, data: js.Value, options: js.Value) !js.Value {
    return .{ .val = try request_js.start(try self.owner(), peer.val, protocol.val, data.val, options.val) };
}
pub fn requestCapacityWatch(self: *@This(), token: js.Value) !js.Value {
    return .{ .val = try js.env().getBoolean(try request_js.watchCapacity(try self.owner(), token.val)) };
}
pub fn requestPull(self: *@This(), handle: js.Value) !js.Value {
    return .{ .val = try request_js.pull(try self.owner(), handle.val) };
}
pub fn requestRetire(self: *@This(), handle: js.Value, abandoned: js.Value) !void {
    try request_js.retire(try self.owner(), handle.val, try decode.boolean(abandoned.val));
}

pub fn incomingRespond(self: *@This(), handle: js.Value, data: js.Value, context: js.Value) !js.Value {
    return .{ .val = try incoming_js.respond(try self.owner(), handle.val, data.val, context.val) };
}
pub fn incomingRelease(self: *@This(), handle: js.Value) !void {
    try incoming_js.release(try self.owner(), handle.val);
}
pub fn incomingReady(self: *@This(), handle: js.Value) !js.Value {
    return .{ .val = try incoming_js.ready(try self.owner(), handle.val) };
}
pub fn incomingTerminal(self: *@This(), handle: js.Value, action: js.Value, status: js.Value, message: js.Value) !void {
    try incoming_js.terminal(try self.owner(), handle.val, action.val, status.val, message.val);
}

pub fn publishGossip(self: *@This(), topic: js.Value, data: js.Value, options: js.Value) !js.Value {
    return .{ .val = try publication_js.publish(try self.owner(), topic.val, data.val, options.val) };
}
pub fn publicationCapacityWatch(self: *@This(), token: js.Value) !js.Value {
    return .{ .val = try js.env().getBoolean(try publication_js.watchCapacity(try self.owner(), token.val)) };
}

test "a notification JavaScript cannot run stops locally" {
    const shim = @import("network_test_support.zig");
    shim.undefined_status = napi.c.napi_cannot_run_js;
    defer shim.undefined_status = napi.c.napi_ok;
    var notified: Runtime = .{ .env = undefined, .bridge = .{ .notify_live = false } };
    onNotify(undefined, undefined, &notified, undefined);
    try std.testing.expect(notified.bridge.stop and !notified.bridge.env_alive);
}
