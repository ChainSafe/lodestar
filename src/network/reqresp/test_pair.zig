const std = @import("std");
const test_allocator = if (@import("builtin").is_test) std.testing.allocator else std.heap.c_allocator;
const ct = @import("consensus_types");
const reqresp = @import("ReqResp.zig");
const protocol = @import("protocol.zig");
const Engine = @import("../quic/Engine.zig");
const multistream = @import("../wire/multistream.zig");
const Event = reqresp.Event;
const ForkEntry = @import("../types.zig").ForkEntry;
const ForkSeq = @import("config").ForkSeq;
const support = @import("../quic/test_support.zig");
const Router = @import("../router.zig").Router;
const Now = @import("../types.zig").Now;
const limits = @import("../quic/limits.zig");
const policy_fixture = @import("policy_fixture.zig");

pub const Outputs = struct { application: []Event = &.{}, control: []Event = &.{} };
pub const OutputCounts = struct { application: usize, control: usize };

pub const deneb_digest = [4]u8{ 0x6a, 0x95, 0xa1, 0xa9 };
pub const fulu_digest = [4]u8{ 0x2f, 0x2f, 0x2f, 0x2f };
pub const Overrides = struct {
    connections: u16 = 128,
    outbound_max: u16 = 8,
    serving_max: u16 = 8,
    inbound_per_connection_max: u8 = 8,
    control_outbound_max: u16 = 8,
    serving_per_source_max: u8 = 4,
    progress_timeout_ms: u64 = 10_000,
    host_timeout_ms: u64 = 60_000,
    quota_timeout_ms: u64 = 60_000,
    forks: ?[]const ForkEntry = null,
    request_fork: ForkSeq = .phase0,
    admission: ?reqresp.Options.Admission = null,
};

pub const Endpoint = struct {
    reqresp: reqresp,
    control_reqresp: reqresp,
    router: Router,

    pub fn init(allocator: std.mem.Allocator, options: reqresp.Options, control_options: reqresp.Options, router_options: Router.Options) !Endpoint {
        var router = try Router.init(allocator, router_options);
        errdefer router.deinit();
        const configured = router.capabilities();
        var active = configured;
        active.receive = .initEmpty();
        active.request = .initEmpty();
        for (std.enums.values(protocol.Protocol)) |which| {
            if (configured.receive.contains(.{ .reqresp = which })) active.receive.insert(.{ .reqresp = which });
            if (configured.request.contains(.{ .reqresp = which })) active.request.insert(.{ .reqresp = which });
        }
        router.setCapabilities(active);
        var application = try reqresp.init(allocator, options);
        errdefer application.deinit();
        return .{ .router = router, .reqresp = application, .control_reqresp = try reqresp.init(allocator, control_options) };
    }

    pub fn deinit(self: *Endpoint) void {
        self.control_reqresp.deinit();
        self.reqresp.deinit();
        self.router.deinit();
    }

    pub fn requests(self: *Endpoint, which: protocol.Protocol) *reqresp {
        return if (protocol.Protocol.Set.control.contains(which)) &self.control_reqresp else &self.reqresp;
    }

    fn readiness(self: *Endpoint, engine: *Engine, events: []const Engine.Event) void {
        for (events) |event| {
            const stream, const route = switch (event) {
                .stream_ready => |ready| .{ ready.stream, engine.route(ready.stream) orelse continue },
                else => continue,
            };
            switch (route.owner) {
                .negotiation => self.router.negotiator.streamReady(route.row, stream),
                .reqresp_outbound, .reqresp_inbound => self.reqresp.streamReady(route, stream),
                .reqresp_control_outbound, .reqresp_control_inbound => self.control_reqresp.streamReady(route, stream),
                .none => {},
                else => unreachable,
            }
        }
    }

    pub fn process(self: *Endpoint, engine: *Engine, events: []const Engine.Event, now: Now, outputs: Outputs) OutputCounts {
        self.readiness(engine, events);

        self.router.transportEvents(engine, events, now);
        for (events) |event| switch (event) {
            .closed => |closed| {
                self.reqresp.connectionClosed(engine, &self.router, closed.conn, now);
                self.control_reqresp.connectionClosed(engine, &self.router, closed.conn, now);
            },
            else => {},
        };

        var outcomes: [Router.outcomes_per_pump]Router.Outcome = undefined;
        const count = self.router.pump(engine, now, &outcomes);
        for (outcomes[0..count]) |outcome| {
            const owner = outcome.protocol orelse continue;
            std.debug.assert(owner == .reqresp);
            if (outcome.result == .ready) engine.bindStream(outcome.stream, .{}) catch {};
            self.requests(owner.reqresp).negotiationResult(&self.router, engine, outcome, now);
        }
        self.router.releaseOutcomes();
        const control = self.control_reqresp.pump(engine, &self.router, now, outputs.control);
        return .{ .control = control, .application = self.reqresp.pump(engine, &self.router, now, outputs.application) };
    }
};

const TransportPair = struct {
    pair: support.Pair = .{},
    client: Endpoint = undefined,
    server: Endpoint = undefined,
    handles: struct { client: Engine.Handle, server: Engine.Handle } = undefined,

    fn init(self: *TransportPair, client: reqresp.Options, server: reqresp.Options, client_control: reqresp.Options, server_control: reqresp.Options) !void {
        const defaults: Engine.Limits = .{};
        try self.pair.init(.{
            .connections_max = client.connections,
            .handshaking_max = @min(client.connections, defaults.handshaking_max),
            .dialing_max = @min(client.connections, defaults.dialing_max),
        }, .{
            .connections_max = server.connections,
            .handshaking_max = @min(server.connections, defaults.handshaking_max),
            .dialing_max = @min(server.connections, defaults.dialing_max),
        });
        errdefer self.pair.deinit();
        self.client = try Endpoint.init(test_allocator, client, client_control, .{ .negotiations_max = 16 });
        errdefer self.client.deinit();
        self.server = try Endpoint.init(test_allocator, server, server_control, .{ .negotiations_max = 16 });
        errdefer self.server.deinit();
        const handles = try support.connectPair(&self.pair);
        self.handles = .{ .client = handles.client, .server = handles.server };
        const client_endpoint = self.pair.client.peerAddress(handles.client).?;
        const server_endpoint = self.pair.server.peerAddress(handles.server).?;
        self.client.reqresp.connectionOpened(handles.client, &self.pair.client.peerId(handles.client).?, &client_endpoint, self.pair.now);
        self.client.control_reqresp.connectionOpened(handles.client, &self.pair.client.peerId(handles.client).?, &client_endpoint, self.pair.now);
        self.server.reqresp.connectionOpened(handles.server, &self.pair.server.peerId(handles.server).?, &server_endpoint, self.pair.now);
        self.server.control_reqresp.connectionOpened(handles.server, &self.pair.server.peerId(handles.server).?, &server_endpoint, self.pair.now);
    }

    fn deinit(self: *TransportPair) void {
        self.client.reqresp.cancelAll(&self.pair.client, &self.client.router, self.pair.now);
        self.server.reqresp.cancelAll(&self.pair.server, &self.server.router, self.pair.now);
        self.server.control_reqresp.cancelAll(&self.pair.server, &self.server.router, self.pair.now);
        self.client.control_reqresp.cancelAll(&self.pair.client, &self.client.router, self.pair.now);
        self.server.deinit();
        self.client.deinit();
        self.pair.deinit();
    }

    pub fn processClient(self: *TransportPair, outputs: Outputs) OutputCounts {
        var events: [limits.events_per_turn_max]Engine.Event = undefined;
        return self.client.process(&self.pair.client, self.pair.events(&self.pair.client, &events), self.pair.now, outputs);
    }

    pub fn processServer(self: *TransportPair, outputs: Outputs) OutputCounts {
        var events: [limits.events_per_turn_max]Engine.Event = undefined;
        return self.server.process(&self.pair.server, self.pair.events(&self.pair.server, &events), self.pair.now, outputs);
    }

    fn step(self: *TransportPair, client: Outputs, server: Outputs) !struct { client: OutputCounts, server: OutputCounts } {
        try self.pair.pump();
        const server_count = self.processServer(server);
        const client_count = self.processClient(client);
        try self.pair.pump();
        return .{ .client = client_count, .server = server_count };
    }
};

/// Delivers readiness only, leaving lifecycle events and pumping under the test's control.
pub fn forward(pair: *support.Pair, engine: *Engine, requests: *reqresp) void {
    for (pair.streamEvents(engine)) |event| {
        const stream, const route = switch (event) {
            .stream_ready => |ready| .{ ready.stream, engine.route(ready.stream) orelse continue },
            else => continue,
        };
        requests.streamReady(route, stream);
    }
}

pub const Pair = struct {
    shared: TransportPair = .{},
    forks: [2]ForkEntry = .{
        .{ .digest = deneb_digest, .fork = .deneb },
        .{ .digest = fulu_digest, .fork = .fulu },
    },
    client_events: [32]Event = undefined,
    client_count: usize = 0,
    client_application_count: usize = 0,
    server_events: [32]Event = undefined,
    server_count: usize = 0,
    server_application_count: usize = 0,
    server_event_capacity: usize = 16,

    pub fn init(self: *Pair, client: Overrides, server: Overrides) !void {
        try self.shared.init(try options(client, &self.forks), try options(server, &self.forks), try controlOptions(client, &self.forks), try controlOptions(server, &self.forks));
    }

    /// Admission defaults over the fixture policy unless the caller supplies admission.
    pub fn options(overrides: Overrides, forks: []const ForkEntry) !reqresp.Options {
        const connections = overrides.connections;
        return .{
            .connections = connections,
            .protocols = .application,
            .outbound_max = overrides.outbound_max,
            .serving_max = overrides.serving_max,
            .inbound_per_connection_max = overrides.inbound_per_connection_max,
            .serving_per_source_max = overrides.serving_per_source_max,
            .progress_timeout_ms = overrides.progress_timeout_ms,
            .forks = overrides.forks orelse forks,
            .request_fork = overrides.request_fork,
            .admission = overrides.admission orelse try reqresp.Options.Admission.defaults(&policy_fixture.config(), @max(1, (overrides.serving_max) / 4)),
            .host_timeout_ms = overrides.host_timeout_ms,
            .quota_timeout_ms = overrides.quota_timeout_ms,
        };
    }

    pub fn controlOptions(overrides: Overrides, forks: []const ForkEntry) !reqresp.Options {
        var result = try options(overrides, forks);
        result.protocols = .control;
        result.routes = .control;
        result.report_non_completion = false;
        result.outbound_max = overrides.control_outbound_max;
        result.serving_max = 0;
        result.serving_per_source_max = 0;
        result.admission = overrides.admission orelse try reqresp.Options.Admission.defaults(&policy_fixture.config(), result.connections);
        result.admission.scope = .peer;
        return result;
    }

    pub fn deinit(self: *Pair) void {
        self.shared.deinit();
    }

    /// Routes both sides' stream events to their negotiators and reqresp owners.
    pub fn forwardEvents(self: *Pair) void {
        self.shared.client.readiness(&self.shared.pair.client, self.shared.pair.streamEvents(&self.shared.pair.client));
        self.shared.server.readiness(&self.shared.pair.server, self.shared.pair.streamEvents(&self.shared.pair.server));
    }

    pub fn pumpOnce(self: *Pair) !void {
        const counts = try self.shared.step(.{ .application = self.client_events[0..16], .control = self.client_events[16..] }, .{ .application = self.server_events[0..self.server_event_capacity], .control = self.server_events[16..][0..self.server_event_capacity] });
        std.mem.copyForwards(Event, self.server_events[counts.server.application..], self.server_events[16..][0..counts.server.control]);
        self.server_application_count = counts.server.application;
        self.client_application_count = counts.client.application;
        self.server_count = counts.server.application + counts.server.control;
        std.mem.copyForwards(Event, self.client_events[counts.client.application..], self.client_events[16..][0..counts.client.control]);
        self.client_count = counts.client.application + counts.client.control;
    }

    pub fn openRaw(self: *Pair, which: protocol.Protocol) !Engine.StreamHandle {
        return self.openRawOn(self.shared.handles.client, which);
    }

    pub fn openRawOn(self: *Pair, conn: Engine.Handle, which: protocol.Protocol) !Engine.StreamHandle {
        const stream = try self.shared.pair.client.openStream(conn);
        var dialer = try multistream.Dialer.init(which.id());
        var bytes: [2 * multistream.message_length_max]u8 = undefined;
        const proposal = try dialer.initialWrite(&bytes);
        try std.testing.expectEqual(proposal.len, try self.shared.pair.client.write(stream, proposal, false));
        return stream;
    }

    pub fn awaitRawSelection(self: *Pair, stream: Engine.StreamHandle, which: protocol.Protocol) !void {
        var dialer = try multistream.Dialer.init(which.id());
        var bytes: [2 * multistream.message_length_max]u8 = undefined;
        var buffered: usize = 0;
        for (0..20) |_| {
            try self.pumpOnce();
            const read = try self.shared.pair.client.read(stream, bytes[buffered..]);
            buffered += read.len;
            const outcome = try dialer.feed(bytes[0..buffered]);
            std.mem.copyForwards(u8, &bytes, bytes[outcome.consumed..buffered]);
            buffered -= outcome.consumed;
            if (outcome.status == .accepted) {
                try std.testing.expectEqual(@as(usize, 0), buffered);
                return;
            }
            try std.testing.expectEqual(.pending, outcome.status);
        }
        return error.TestUnexpectedResult;
    }

    pub fn clientEvents(self: *const Pair) []const Event {
        return self.client_events[0..self.client_count];
    }

    pub fn serverEvents(self: *const Pair) []const Event {
        return self.server_events[0..self.server_count];
    }
};

pub fn statusBytes(seed: u8) [ct.phase0.Status.fixed_size]u8 {
    const status = ct.phase0.Status.Type{
        .fork_digest = deneb_digest,
        .finalized_root = [_]u8{seed} ** 32,
        .finalized_epoch = seed,
        .head_root = [_]u8{seed +% 1} ** 32,
        .head_slot = @as(u64, seed) * 32,
    };
    var bytes: [ct.phase0.Status.fixed_size]u8 = undefined;
    _ = ct.phase0.Status.serializeIntoBytes(&status, &bytes);
    return bytes;
}

pub fn requestStatus(setup: *Pair, request_ssz: *[ct.phase0.Status.fixed_size]u8, sink: []u8) !reqresp.RequestHandle {
    request_ssz.* = statusBytes(5);
    return setup.shared.client.control_reqresp.request(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.handles.client,
        .status_v1,
        request_ssz,
        sink,
        .{},
        setup.shared.pair.now,
    );
}

pub fn requestBlocks(setup: *Pair, request_ssz: *[24]u8, count: u64, sink: []u8) !reqresp.RequestHandle {
    const Request = ct.phase0.BeaconBlocksByRangeRequest;
    const request = Request.Type{ .start_slot = 1, .count = count, .step = 1 };
    _ = Request.serializeIntoBytes(&request, request_ssz);
    return setup.shared.client.reqresp.request(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.handles.client,
        .blocks_by_range_v2,
        request_ssz,
        sink,
        .{},
        setup.shared.pair.now,
    );
}

pub fn firstFailure(events: []const Event) ?reqresp.Failure {
    for (events) |event| {
        if (event == .failed) return event.failed.reason;
    }
    return null;
}

pub fn waitForRequest(setup: *Pair) !void {
    var request_seen = false;
    var rounds: usize = 0;
    while (rounds < 10 and !request_seen) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| {
            if (event == .request) request_seen = true;
        }
    }
    try std.testing.expect(request_seen);
}
