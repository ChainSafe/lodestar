const Gossipsub = @import("Gossipsub.zig");
const Engine = @import("../quic/Engine.zig");
const MessageEvent = @import("messages.zig").MessageEvent;
const protocols_test_support = @import("../protocols_test_support.zig");
const ReqResp = @import("../reqresp/ReqResp.zig");
const policy_fixture = @import("../reqresp/policy_fixture.zig");
const topic_fixture = @import("topic_fixture.zig");
const test_support = @import("test_support.zig");
const constants = @import("constants.zig");

pub const Pair = struct {
    shared: protocols_test_support.ProtocolsPair = .{},

    pub fn init(self: *Pair) !void {
        try self.initOpts(.{ .random_seed = 1 }, .{ .random_seed = 1 });
    }

    pub fn initOpts(self: *Pair, client: Gossipsub.Options, server: Gossipsub.Options) !void {
        try self.initWindow(client, server, null);
    }

    /// As `initOpts`, with the server granting `stream_window` bytes of credit on each stream the
    /// client opens until it reads them.
    pub fn initWindow(self: *Pair, client: Gossipsub.Options, server: Gossipsub.Options, stream_window: ?u64) !void {
        const reqresp: ReqResp.Options = .{ .protocols = .application, .forks = &.{}, .connections = 128, .outbound_max = 1, .serving_max = 1, .inbound_per_connection_max = 1, .admission = try ReqResp.Options.Admission.defaults(&policy_fixture.config(), 1) };
        const topics = &.{ topic_fixture.bytes(.{ 1, 2, 3, 4 }), topic_fixture.bytes(.{ 0x6a, 0x95, 0xa1, 0xa9 }) };
        var client_options = client;
        client_options.topic_policy = if (client.topic_policy.len > 0) client.topic_policy else topics;
        var server_options = server;
        server_options.topic_policy = if (server.topic_policy.len > 0) server.topic_policy else topics;
        var control = reqresp;
        control.protocols = .control;
        control.admission.scope = .peer;
        control.routes = .control;
        control.report_non_completion = false;
        try self.shared.initWindow(.{ .reqresp = reqresp, .control_reqresp = control, .gossipsub = client_options, .router = .{ .negotiations_max = 8 } }, .{ .reqresp = reqresp, .control_reqresp = control, .gossipsub = server_options, .router = .{ .negotiations_max = 8 } }, stream_window);
    }

    pub fn connectMesh(self: *Pair) !void {
        try test_support.subscribe(self.shared.client.gossipsub, "/eth2/01020304/beacon_block/ssz_snappy");
        try test_support.subscribe(self.shared.server.gossipsub, "/eth2/01020304/beacon_block/ssz_snappy");
        for (0..20) |_| try self.pumpOnce();
        self.shared.pair.advance(constants.heartbeat_interval_ms + 1);
        for (0..20) |_| try self.pumpOnce();
    }

    pub fn deinit(self: *Pair) void {
        self.shared.deinit();
    }

    pub fn pumpOnce(self: *Pair) !void {
        _ = try self.shared.step(.{}, .{});
    }

    pub fn clientStream(self: *const Pair) Engine.StreamHandle {
        const sessions = self.shared.client.gossipsub.sessions;
        return sessions.outStream(sessions.find(self.shared.handles.client).?).?;
    }

    pub fn serverStream(self: *const Pair) Engine.StreamHandle {
        const sessions = self.shared.server.gossipsub.sessions;
        return sessions.outStream(sessions.find(self.shared.handles.server).?).?;
    }

    /// Routes the client's stream events polled since the last call to its gossip sessions,
    /// for tests that drive the gossip turn directly.
    pub fn forwardClient(self: *Pair) void {
        protocols_test_support.forward(&self.shared.pair, &self.shared.pair.client, .{ .gossip = self.shared.client.gossipsub });
    }

    pub fn forwardServer(self: *Pair) void {
        protocols_test_support.forward(&self.shared.pair, &self.shared.pair.server, .{ .gossip = self.shared.server.gossipsub });
    }

    /// Messages the client admitted in the last step.
    pub fn clientMessages(self: *const Pair) []const MessageEvent {
        return self.shared.client_inbox.messages();
    }

    /// Messages the server admitted in the last step.
    pub fn serverMessages(self: *const Pair) []const MessageEvent {
        return self.shared.server_inbox.messages();
    }
};
