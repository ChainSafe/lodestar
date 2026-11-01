//! Owns the application discovery transport, one demand-driven walk and liveness probes.
//! Initialize at the final address and serialize entry, including cancellation and teardown.
const time = @import("../time.zig");
const std = @import("std");
const d = @import("discv5");
const adapter = @import("enr.zig");
const types = @import("types.zig");
const local_state = @import("../local_state.zig");
const advertisement = @import("../advertisement.zig");
const Sockets = @import("udp").Sockets;
const KeyPair = @import("../wire/keys.zig").KeyPair;
const types_mod = @import("../types.zig");
const Histogram = @import("../metrics/histogram.zig").Duration;

const Storage = struct {
    observations: d.AddressVotes,
    candidates: d.Lookup.Candidates,
    expiries: [d.CallTable.capacity_max]d.CallTable.Expired,
};

pub const Discovery = struct {
    /// Lookup queries touch many one-off nodes. Idle expiry keeps the discv5 session store at recent
    /// contacts instead of pinning it at capacity; routing-table peers are revalidated every 300 s.
    pub const discovery_session_capacity: usize = 2_048;
    pub const discovery_session_idle_timeout_ms: u64 = 10 * 60_000;
    pub const Config = struct {
        advertisement: ?advertisement.Hints = null,
        fixed: advertisement.Endpoints = .{},
        bind: Sockets.Bindings,
        sequence: u64 = 1,
        bootstrap: []const d.identity.enr.Record = &.{},
    };
    pub const Error = d.Transport.Error || d.Maintenance.Error || d.Lookup.Error || adapter.Error || std.mem.Allocator.Error || error{ Stopped, InvalidOptions, InvalidDemand, InvalidAdvertisement, InvalidBootstrap, TooManyBootstraps };
    pub const bootstrap_max: usize = 64;
    pub const queries_max = 128;
    pub const candidates_per_step = d.types.findnode_result_max + 1;
    pub const Rejection = enum { missing_eth2, incompatible_fork, invalid_enr, no_quic, endpoint_family, endpoint_scope, demand, output_capacity };
    pub const rejection_count = @typeInfo(Rejection).@"enum".fields.len;
    pub const datagram_rejection_count = @typeInfo(d.types.RejectReason).@"enum".fields.len;
    /// Foreground lookups started and candidates handed to peer selection.
    pub const Counters = struct {
        lookups_started: u64 = 0,
        candidates_published: u64 = 0,
        lookup_time: Histogram(&.{ 5_000, 60_000 }) = .{},
    };
    pub const Options = struct {
        quic_mode: d.types.Mode = .dual,
        query_interval_ms: u64 = 1_000,
        local_retry_ms: u64 = 1_000,
        maintenance: d.Maintenance.Config = .{},
        observations: [2]d.AddressVotes.Policy = .{ .{}, .{} },
    };
    pub const Demand = struct {
        general: bool = false,
        attnets: [8]u8 = @splat(0),
        syncnets: u8 = 0,
        custody: bool = false,

        fn active(self: *const Demand) bool {
            return (self.general or self.custody or self.syncnets != 0 or !std.mem.allEqual(u8, &self.attnets, 0));
        }
        fn matches(self: *const Demand, candidate: *const adapter.Candidate, context: *const types.ForkContext) bool {
            if (self.general or (self.custody and (candidate.hints.custody_group_count != null or context.custody_requirement > 0))) return true;
            if (candidate.hints.syncnets) |bits| if (bits & self.syncnets != 0) return true;
            if (candidate.hints.attnets) |bits| {
                for (bits, self.attnets) |actual, wanted| if (actual & wanted != 0) return true;
            }
            return false;
        }
    };
    pub const Failure = struct { cause: Error, stage: d.Transport.FailureStage };

    pub const Result = struct {
        learned: [2]?d.types.Address = .{ null, null },
        candidates: usize = 0,
        cancelled: bool = false,
        failure: ?Failure = null,
    };

    allocator: std.mem.Allocator,
    transport: d.Transport,
    endpoints: advertisement.Endpoints = .{},
    quic_ports: [2]?u16 = .{ null, null },
    quic_bound: [2]bool = .{ false, false },
    /// Output workspace for the application owner, consumed before the next step.
    candidates: [candidates_per_step]adapter.Candidate = undefined,
    storage: *Storage,
    maintenance: d.Maintenance,
    lookup: ?d.Lookup = null,
    context: types.ForkContext,
    options: Options,
    demand: Demand = .{},
    query_due_ms: u64,
    refill_due_ms: u64 = 0,
    resource_retry_ms: u64 = 0,
    lookup_finishes: [@typeInfo(d.Lookup.FinishReason).@"enum".fields.len]u64 = @splat(0),
    stopped: bool = false,
    counters: Counters = .{},
    rejections: [rejection_count]u64 = @splat(0),
    datagram_rejections: [datagram_rejection_count]u64 = @splat(0),
    lookup_started_ms: u64 = 0,
    lookup_published: u64 = 0,
    empty_lookups: u3 = 0,

    pub fn init(self: *Discovery, allocator: std.mem.Allocator, io: std.Io, options: Config, buffers: Sockets.Buffers, host: *const KeyPair, local: *const types.LocalState, fork_schedule: local_state.ForkSchedule, quic: [2]?types.Address, now_ms: u64) !void {
        var sockets = try Sockets.bind(io, options.bind);
        errdefer sockets.close(io);
        sockets.requestBuffersLogged(buffers, .network_discovery);
        var udp_addresses: [2]?d.types.Address = .{ null, null };
        for (sockets.values, 0..) |socket, i| if (socket) |value| {
            udp_addresses[i] = d.types.Address.fromNetwork(value.address);
        };
        const resolved = try advertisement.resolve(if (options.advertisement) |*value| value else null, &options.fixed, &quic, &udp_addresses);
        try advertisement.validate(resolved.endpoints);
        const quic_bound = [2]bool{ quic[0] != null, quic[1] != null };
        try validateEndpointFamilies(resolved.endpoints, quic_bound, &sockets);
        const announced = advertisementFor(local, fork_schedule, resolved.endpoints);
        const record = try adapter.build(&host.inner, options.sequence, &announced, &local.fork);
        try adapter.requireIdentity(&record, &types.PeerId.fromPublicKey(&host.publicKey()));
        var coordinator_options: Options = .{};
        coordinator_options.observations = resolved.observations;
        coordinator_options.quic_mode = if (quic[0] == null) .ip6 else if (quic[1] == null) .ip4 else .dual;
        try self.initBound(allocator, sockets, &host.inner, &record, &local.fork, options.bootstrap, now_ms, coordinator_options, .{ .session_capacity = discovery_session_capacity, .session_idle_timeout_ms = discovery_session_idle_timeout_ms });
        self.endpoints = resolved.endpoints;
        self.quic_ports = resolved.quic_ports;
        self.quic_bound = quic_bound;
    }

    /// Takes ownership of bound sockets on success. Records are immutable authenticated values.
    pub fn initBound(self: *Discovery, allocator: std.mem.Allocator, sockets: Sockets, key: *const d.identity.crypto.KeyPair, record: *const d.identity.enr.Record, context: *const types.ForkContext, bootstrap: []const d.identity.enr.Record, now_ms: u64, options: Options, engine_config: d.Engine.Config) !void {
        try context.validate();
        if (options.query_interval_ms == 0 or options.query_interval_ms > 86_400_000 or options.local_retry_ms == 0 or options.local_retry_ms > 86_400_000) return error.InvalidOptions;
        if (bootstrap.len > bootstrap_max) return error.TooManyBootstraps;
        for (bootstrap) |*seed| if (seed.endpoint() == null) return error.InvalidBootstrap;
        var maintenance: d.Maintenance = undefined;
        try maintenance.init(now_ms, options.maintenance, sockets.mode());
        const storage = try allocator.create(Storage);
        errdefer allocator.destroy(storage);
        storage.observations.init(options.observations);
        maintenance.observations = &storage.observations;
        self.* = .{ .allocator = allocator, .transport = undefined, .storage = storage, .maintenance = maintenance, .context = context.*, .options = options, .query_due_ms = now_ms };
        try self.transport.init(allocator, sockets, key.*, record.*, engine_config);
        for (bootstrap) |*seed| {
            const address = seed.endpointFor(sockets.mode()) orelse continue;
            const peer: d.types.Endpoint = .{ .node_id = seed.node_id, .address = address };
            _ = self.transport.engine.routing.addKnown(&peer, seed) catch |err| switch (err) {
                error.AddressLimit, error.SelfEntry => continue,
                else => unreachable,
            };
        }
    }

    pub fn deinit(self: *Discovery, io: std.Io) void {
        self.shutdown();
        self.transport.deinit(self.allocator, io);
        self.allocator.destroy(self.storage);
        self.* = undefined;
    }

    pub fn localRecord(self: *const Discovery) *const d.identity.enr.Record {
        return self.transport.engine.localRecord();
    }

    /// The caller has validated the endpoints and fork context. Null keeps the current ENR.
    pub fn prepareAdvertisement(self: *const Discovery, announcement: ?*const adapter.LocalAdvertisement, endpoints: advertisement.Endpoints, context: *const types.ForkContext) Error!?d.identity.enr.Record {
        if (self.stopped) return error.Stopped;
        try validateEndpointFamilies(endpoints, self.quic_bound, &self.transport.sockets);
        return if (announcement) |local|
            try adapter.build(&self.transport.engine.channel.local_key, try adapter.nextSequence(self.localRecord().sequence), local, context)
        else
            null;
    }

    /// Install only a record prepared by this owner without intervening state changes.
    pub fn advertise(self: *Discovery, record: ?*const d.identity.enr.Record, endpoints: advertisement.Endpoints, context: *const types.ForkContext) void {
        std.debug.assert(!self.stopped);
        if (record) |value| self.transport.engine.updateLocalRecord(value) catch unreachable;
        self.endpoints = endpoints;
        if (!std.mem.eql(u8, &self.context.digest, &context.digest)) self.cancelForeground();
        self.context = context.*;
    }

    pub fn learnedEndpoints(self: *const Discovery, learned: [2]?d.types.Address) advertisement.Endpoints {
        var endpoints = self.endpoints;
        for (learned, 0..) |value, family| if (value) |address| switch (address) {
            .ip4 => |ip| {
                endpoints.ip4 = ip.octets;
                endpoints.udp = ip.port;
                endpoints.quic = self.quic_ports[family];
            },
            .ip6 => |ip| {
                endpoints.ip6 = ip.octets;
                endpoints.udp6 = ip.port;
                endpoints.quic6 = self.quic_ports[family];
            },
        };
        return endpoints;
    }

    /// Replaces demand until the next update or shutdown. Empty demand cancels the foreground walk.
    pub fn request(self: *Discovery, demand: Demand) Error!void {
        if (self.stopped) return error.Stopped;
        if (demand.syncnets & 0xf0 != 0) return error.InvalidDemand;
        self.demand = demand;
        if (!demand.active()) self.cancelForeground();
    }

    pub fn schedule(self: *const Discovery) types_mod.Schedule {
        if (self.stopped) return .{};
        var next = self.transport.engine.nextDeadlineMs() orelse std.math.maxInt(u64);
        if (self.maintenance.nextDeadlineMs(&self.transport.engine)) |deadline| next = @min(next, @max(deadline, self.resource_retry_ms));
        if (self.lookup) |*lookup| {
            if (lookup.waitingCount() < d.Lookup.parallelism) next = @min(next, @max(self.refill_due_ms, self.resource_retry_ms));
        } else if (self.demand.active()) next = @min(next, @max(self.query_due_ms, self.resource_retry_ms));
        return .{ .deadline = time.optionalMilliseconds(next) };
    }

    /// Advances one bounded turn using the owner's clock and readiness. No event borrow escapes.
    pub fn advance(self: *Discovery, io: std.Io, now_ms: u64, ready: *[2]bool, out: []adapter.Candidate) Error!Result {
        if (self.stopped) return error.Stopped;
        var result = Result{};
        self.refill(io, now_ms) catch |err| {
            result.cancelled = err == error.Canceled;
            result.failure = .{ .cause = err, .stage = .coordinator };
            self.resource_retry_ms = now_ms +| self.options.local_retry_ms;
        };
        const input: d.Transport.Input = if (result.cancelled) error.Canceled else self.transport.receive(io, ready);
        const progress = try self.transport.advance(io, now_ms, &self.storage.expiries, input);
        var consumed = self.consume(&progress, self.storage.expiries[0..progress.calls_expired], out);
        if (!consumed.cancelled and progress.event == .request and progress.event.request.message == .talk_request) {
            const incoming = progress.event.request;
            const response: d.wire.message.Message = .{ .talk_response = .{
                .request_id = incoming.message.talk_request.request_id,
                .response = &.{},
            } };
            self.transport.sendResponse(io, incoming.peer, &response, now_ms) catch |err| {
                consumed.cancelled = consumed.cancelled or err == error.Canceled;
                if (err != error.DestinationUnreachable and consumed.failure == null) {
                    consumed.failure = .{ .cause = err, .stage = .process };
                }
            };
        }
        consumed.cancelled = result.cancelled or consumed.cancelled;
        consumed.failure = result.failure orelse consumed.failure;
        return consumed;
    }

    /// Supports hosts that drive this owner's Transport themselves. Consume every result exactly
    /// once before another Transport advance, including results containing failure. The host answers
    /// TALK requests itself; advance supplies the unsupported-protocol response. No slice escapes.
    pub fn consume(self: *Discovery, progress: *const d.Transport.AdvanceResult, expiries: []const d.CallTable.Expired, out: []adapter.Candidate) Result {
        std.debug.assert(expiries.len == progress.calls_expired and expiries.len <= d.CallTable.capacity_max);
        var result = Result{ .cancelled = progress.cancelled, .failure = if (progress.failure) |failure| .{ .cause = failure.cause, .stage = failure.stage } else null };
        if (self.stopped) return result;
        switch (progress.datagram) {
            .timeout, .accepted => {},
            .rejected => |reason| self.datagram_rejections[@intFromEnum(reason)] +|= 1,
        }
        for (expiries) |expired| {
            const lookup_expired = if (self.lookup) |*lookup| lookup.onFailure(&self.transport.engine, expired.handle) else false;
            if (!lookup_expired) _ = self.maintenance.onFailure(&self.transport.engine, expired.handle, progress.now_ms, .expired);
        }
        if (progress.event == .response) {
            const response = &progress.event.response;
            if (response.matched.response == .pong) {
                if (self.storage.observations.observe(&response.peer, response.matched.handle, &response.matched.response.pong, progress.now_ms)) |address| {
                    result.learned[if (address == .ip4) @as(usize, 0) else 1] = address;
                }
            }
        }
        self.consumeEvent(progress, out, &result);
        if (self.lookup) |*lookup| if (lookup.isFinished()) {
            self.lookup_finishes[@intFromEnum(lookup.finishReason().?)] +|= 1;
            self.counters.lookup_time.observe(progress.now_ms -| self.lookup_started_ms);
            std.log.scoped(.network_discovery).debug("lookup_completed reason={s} queried={d} candidates={d} published={d} elapsed_ms={d}", .{ @tagName(lookup.finishReason().?), lookup.queries_started, lookup.candidateCount(), self.counters.candidates_published -| self.lookup_published, progress.now_ms -| self.lookup_started_ms });
            self.lookup = null;
            self.empty_lookups = if (self.counters.candidates_published == self.lookup_published) @min(self.empty_lookups +| 1, 6) else 0;
            const delay = self.options.query_interval_ms *| (@as(u64, 1) << self.empty_lookups);
            self.query_due_ms = progress.now_ms +| delay;
        };
        return result;
    }

    pub fn shutdown(self: *Discovery) void {
        if (self.stopped) return;
        self.cancelForeground();
        self.maintenance.cancel(&self.transport.engine);
        self.demand = .{};
        self.stopped = true;
    }

    fn refill(self: *Discovery, io: std.Io, now_ms: u64) Error!void {
        if (now_ms < self.resource_retry_ms) return;
        if (self.lookup == null and self.demand.active() and now_ms >= self.query_due_ms) {
            self.query_due_ms = now_ms +| self.options.query_interval_ms;
            var target: d.types.NodeId = undefined;
            try std.Io.randomSecure(io, &target);
            var seeds: [d.Lookup.result_max]d.RoutingTable.Entry = undefined;
            const closest = self.transport.engine.closestNodes(&target, &seeds);
            var lookup: d.Lookup = undefined;
            try lookup.init(&self.storage.candidates, self.transport.engine.localRecord().node_id, target, closest, self.transport.sockets.mode());
            lookup.filter = .{ .context = &self.context, .matches = matchesNetwork };
            lookup.query_limit = queries_max;
            self.lookup = lookup;
            self.lookup_started_ms = now_ms;
            self.lookup_published = self.counters.candidates_published;
            self.counters.lookups_started +|= 1;
            std.log.scoped(.network_discovery).debug("lookup_started target={x} seeds={d}", .{ target, closest.len });
        }
        if (self.maintenance.nextDeadlineMs(&self.transport.engine)) |deadline| if (now_ms >= deadline) {
            _ = try self.start(io, now_ms, true);
        };
        if (self.lookup == null or now_ms < self.refill_due_ms) return;
        self.refill_due_ms = now_ms +| self.options.local_retry_ms;
        for (0..d.Lookup.parallelism) |_| {
            if (!try self.start(io, now_ms, false)) break;
        }
    }

    fn cancelForeground(self: *Discovery) void {
        if (self.lookup) |*lookup| lookup.cancel(&self.transport.engine);
        self.lookup = null;
    }

    fn start(self: *Discovery, io: std.Io, now_ms: u64, background: bool) Error!bool {
        const started = (if (background) self.transport.startMaintenance(io, &self.maintenance, now_ms) else self.transport.startLookup(io, &self.lookup.?, now_ms)) catch |err| switch (err) {
            error.TableFull, error.PeerBusy => return false,
            else => return err,
        };
        // Transport released the refused call and reported a local failure to its owner, so the
        // refusal fails only its destination and the step goes on.
        if (started.failure) |err| if (err != error.DestinationUnreachable) return err;
        return started.started;
    }

    fn consumeEvent(self: *Discovery, progress: *const d.Transport.AdvanceResult, out: []adapter.Candidate, result: *Result) void {
        switch (progress.event) {
            .response, .failed => {},
            else => return,
        }
        var consumption: d.Engine.Event.Consumption = .{};
        if (self.lookup) |*lookup| {
            consumption = lookup.onEvent(&self.transport.engine, &progress.event, progress.now_ms) catch |err| {
                result.failure = result.failure orelse .{ .cause = err, .stage = .coordinator };
                return;
            };
            if (consumption.consumed) self.refill_due_ms = progress.now_ms;
        }
        if (!consumption.consumed) consumption = self.maintenance.onEvent(&self.transport.engine, &progress.event, progress.now_ms);
        if (!consumption.consumed) return;
        if (progress.event == .response) {
            const response = &progress.event.response;
            if (consumption.responder) |*record| self.publishResponse(response, record, out, result);
            self.publishReferrals(response, out, result);
        }
    }

    fn publishReferrals(self: *Discovery, response: *const d.Engine.AuthenticatedResponse, out: []adapter.Candidate, result: *Result) void {
        std.debug.assert(response.node_records.len <= d.types.findnode_result_max);
        for (response.node_records) |*record| {
            if (std.mem.eql(u8, &record.node_id, &response.peer.node_id) or
                std.mem.eql(u8, &record.node_id, &self.transport.engine.localRecord().node_id)) continue;
            self.publish(record, response.peer.address, out, result);
        }
    }

    fn publishResponse(self: *Discovery, response: *const d.Engine.AuthenticatedResponse, known: *const d.identity.enr.Record, out: []adapter.Candidate, result: *Result) void {
        std.debug.assert(response.matched.terminal);
        std.debug.assert(std.mem.eql(u8, &known.node_id, &response.peer.node_id));
        var record = known.*;
        if (response.record) |*updated| if (updated.sequence > record.sequence and std.mem.eql(u8, &updated.node_id, &response.peer.node_id)) {
            record = updated.*;
        };
        std.debug.assert(response.node_records.len <= d.types.findnode_result_max);
        for (response.node_records) |*updated| {
            if (updated.sequence > record.sequence and std.mem.eql(u8, &updated.node_id, &response.peer.node_id)) record = updated.*;
        }
        self.publish(&record, response.peer.address, out, result);
    }

    fn rejected(self: *Discovery, reason: Rejection) void {
        self.rejections[@intFromEnum(reason)] +|= 1;
    }

    fn publish(self: *Discovery, record: *const d.identity.enr.Record, source: d.types.Address, out: []adapter.Candidate, result: *Result) void {
        if (!self.demand.active()) return;
        var candidate = adapter.decode(record, &self.context) catch |err| {
            self.rejected(switch (err) {
                error.MissingEth2 => .missing_eth2,
                error.IncompatibleFork => .incompatible_fork,
                else => .invalid_enr,
            });
            return;
        };
        if (candidate.address_count == 0) {
            self.rejected(.no_quic);
            return;
        }
        var count: u8 = 0;
        var supported: u8 = 0;
        for (candidate.addresses[0..candidate.address_count]) |address| {
            if (!self.options.quic_mode.supports(address)) continue;
            supported += 1;
            if (!relayAllowed(source, address)) continue;
            candidate.addresses[count] = address;
            count += 1;
        }
        candidate.address_count = count;
        @memset(candidate.addresses[count..], .unspecified);
        if (count == 0) {
            self.rejected(if (supported == 0) .endpoint_family else .endpoint_scope);
            return;
        }
        if (!self.demand.matches(&candidate, &self.context)) {
            self.rejected(.demand);
            return;
        }
        if (result.candidates == out.len) {
            self.rejections[@intFromEnum(Rejection.output_capacity)] +|= 1;
            return;
        }
        out[result.candidates] = candidate;
        result.candidates += 1;
        self.counters.candidates_published +|= 1;
    }
};

pub fn advertisementFor(local: *const types.LocalState, schedule: local_state.ForkSchedule, endpoints: advertisement.Endpoints) adapter.LocalAdvertisement {
    return .{
        .fork = .{ .digest = local.fork.digest, .next_version = schedule.next_version, .next_epoch = schedule.next_epoch },
        .next_fork_digest = if (schedule.fulu_scheduled or local.fork.fork.gte(.fulu)) schedule.next_digest else null,
        .attnets = local.metadata.attnets,
        .syncnets = if (local.fork.fork.gte(.altair)) local.metadata.syncnets else null,
        .custody_group_count = local.metadata.custody_group_count,
        .ip4 = endpoints.ip4,
        .ip6 = endpoints.ip6,
        .udp = endpoints.udp,
        .udp6 = endpoints.udp6,
        .quic = endpoints.quic,
        .quic6 = endpoints.quic6,
    };
}
fn validateEndpointFamilies(endpoints: advertisement.Endpoints, quic: [2]bool, udp: *const Sockets) error{InvalidAdvertisement}!void {
    if ((endpoints.quic != null and !quic[0]) or (endpoints.quic6 != null and !quic[1]) or
        (endpoints.udp != null and udp.values[0] == null) or (endpoints.ip6 != null and (endpoints.udp6 orelse endpoints.udp) != null and udp.values[1] == null)) return error.InvalidAdvertisement;
}

fn matchesNetwork(context_opaque: *const anyopaque, record: *const d.identity.enr.Record) bool {
    const context: *const types.ForkContext = @ptrCast(@alignCast(context_opaque));
    const eth2 = (record.fieldBytes("eth2") catch return false) orelse return false;
    if (eth2.len != 16 or !std.mem.eql(u8, eth2[0..4], &context.digest)) return false;
    return (record.fieldBytes("quic") catch return false) != null or (record.fieldBytes("quic6") catch return false) != null;
}

pub fn relayAllowed(source: d.types.Address, candidate: types.Address) bool {
    if (candidate.port() < d.Lookup.discovered_port_min) return false;
    if (candidate == .ip6 and candidate.ip6.octets[0] == 0xfe and candidate.ip6.octets[1] & 0xc0 == 0x80) return false;
    return d.address_policy.relayAllowed(source, candidate);
}

test {
    _ = @import("discovery_test.zig");
    _ = @import("discovery_socket_test.zig");
}
