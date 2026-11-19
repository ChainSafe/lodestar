const topic_fixture = @import("gossipsub/topic_fixture.zig");
const std = @import("std");
const support = @import("quic/test_support.zig");
const Protocols = @import("protocols.zig").Protocols;
const Engine = @import("quic/Engine.zig");
const Inbox = @import("gossipsub/test_support.zig").Inbox;
const identify_mod = @import("identify/root.zig");
const KeyPair = @import("wire/keys.zig").KeyPair;
const binding = @import("quic/binding.zig");
const limits = @import("quic/limits.zig");
const negotiate = @import("negotiate.zig");
const ReqResp = @import("reqresp/ReqResp.zig");
const Gossipsub = @import("gossipsub/Gossipsub.zig");
const PeerId = @import("wire/peer_id.zig").PeerId;

pub fn initProtocols(allocator: std.mem.Allocator, options: Protocols.Options, transport: *const Engine) !Protocols {
    const local = try options.identify.makeLocal(&transport.tls.local_peer_id, &transport.local);
    var configured = options;
    if (configured.gossipsub.topic_policy.len == 0) configured.gossipsub.topic_policy = &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })};
    return Protocols.init(allocator, configured, &local);
}

pub fn fixtureLocal(options: identify_mod.Handler.Options) !identify_mod.Local {
    const key = try KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{1}));
    const peer = PeerId.fromPublicKey(&key.publicKey());
    return identify_mod.Local.init(&peer, options.agent, options.protocol_version, if (options.addresses.len == 0) &.{support.client_address} else options.addresses);
}

/// Admits gossip peers explicitly, as PeerManager does, and delivers gossip through inboxes.
pub const ProtocolsPair = struct {
    pair: support.Pair = .{},
    client: Protocols = undefined,
    server: Protocols = undefined,
    client_inbox: Inbox = .{},
    server_inbox: Inbox = .{},
    handles: struct { client: Engine.Handle, server: Engine.Handle } = undefined,

    pub fn init(self: *ProtocolsPair, client: Protocols.Options, server: Protocols.Options) !void {
        try self.initWindow(client, server, null);
    }

    /// As `init`, with the server granting `stream_window` bytes of credit on each stream the
    /// client opens until it reads them.
    pub fn initWindow(self: *ProtocolsPair, client: Protocols.Options, server: Protocols.Options, stream_window: ?u64) !void {
        try self.pair.init(.{}, .{});
        errdefer self.pair.deinit();
        if (stream_window) |window| binding.c.quiche_config_set_initial_max_stream_data_bidi_remote(self.pair.server.config.ptr, window);
        self.client = try initProtocols(std.testing.allocator, client, &self.pair.client);
        errdefer self.client.deinit();
        self.server = try initProtocols(std.testing.allocator, server, &self.pair.server);
        errdefer self.server.deinit();
        self.client_inbox.attach(self.client.gossipsub);
        self.server_inbox.attach(self.server.gossipsub);
        const handles = try support.connectPair(&self.pair);
        self.handles = .{ .client = handles.client, .server = handles.server };
        _ = self.client.gossipsub.peerConnected(&self.pair.client, handles.client, false, self.pair.now);
        _ = self.server.gossipsub.peerConnected(&self.pair.server, handles.server, false, self.pair.now);
    }

    pub fn deinit(self: *ProtocolsPair) void {
        self.client.shutdown(&self.pair.client, self.pair.now);
        self.server.shutdown(&self.pair.server, self.pair.now);
        self.server.deinit();
        self.client.deinit();
        self.server_inbox.deinit();
        self.client_inbox.deinit();
        self.pair.deinit();
    }

    pub const Counts = struct { client: Protocols.OutputCounts, server: Protocols.OutputCounts };

    /// Processes each endpoint's protocols exactly once. Transport delivery does not advance the clock.
    /// Gossip delivered in earlier steps is cleared first.
    pub fn step(self: *ProtocolsPair, client: Protocols.Outputs, server: Protocols.Outputs) !Counts {
        self.client_inbox.clear();
        self.server_inbox.clear();
        try self.pair.pump();
        const server_count = self.processServer(server);
        const client_count = self.processClient(client);
        try self.pair.pump();
        return .{ .client = client_count, .server = server_count };
    }

    pub fn processClient(self: *ProtocolsPair, outputs: Protocols.Outputs) Protocols.OutputCounts {
        return self.process(&self.client, &self.pair.client, outputs);
    }

    pub fn processServer(self: *ProtocolsPair, outputs: Protocols.Outputs) Protocols.OutputCounts {
        return self.process(&self.server, &self.pair.server, outputs);
    }

    fn process(self: *ProtocolsPair, owner: *Protocols, transport: *Engine, outputs: Protocols.Outputs) Protocols.OutputCounts {
        var events: [limits.events_per_turn_max]Engine.Event = undefined;
        return owner.process(transport, self.pair.events(transport, &events), self.pair.now, outputs);
    }
};

/// Routes readiness to the owners a test drives directly. Lifecycle handling stays with the test.
pub const Owners = struct {
    negotiator: ?*negotiate.Negotiator = null,
    identify: ?*identify_mod.Handler = null,
    reqresp: ?*ReqResp = null,
    gossip: ?*Gossipsub = null,

    pub fn route(self: Owners, engine: *Engine, events: []const Engine.Event) void {
        for (events) |event| {
            const stream, const bound = switch (event) {
                .stream_ready => |ready| .{ ready.stream, engine.route(ready.stream) orelse continue },
                else => continue,
            };
            switch (bound.owner) {
                .negotiation => if (self.negotiator) |owner| owner.streamReady(bound.row, stream),
                .identify => if (self.identify) |owner| owner.streamReady(bound.row, stream),
                .reqresp_outbound, .reqresp_inbound, .reqresp_control_outbound, .reqresp_control_inbound => if (self.reqresp) |owner| owner.streamReady(bound, stream),
                .gossip_inbound, .gossip_outbound => if (self.gossip) |owner| owner.streamReady(engine, bound, stream, event.stream_ready.ready),
                .none => {},
            }
        }
    }
};

pub fn forward(pair: *support.Pair, engine: *Engine, owners: Owners) void {
    owners.route(engine, pair.streamEvents(engine));
}
