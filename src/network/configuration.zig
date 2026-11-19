const std = @import("std");
const Protocols = @import("protocols.zig").Protocols;
const peer_manager = @import("peer_manager.zig");
const Engine = @import("quic/Engine.zig");
const Transport = @import("transport.zig").Transport;
const udp = @import("udp");
const rr = @import("reqresp/ReqResp.zig");
const gossip = @import("gossipsub/options.zig");
const c = @import("gossipsub/constants.zig");
const peers = @import("peers/root.zig");
const Router = @import("router.zig").Router;
const identify_mod = @import("identify/root.zig");
const ForkEntry = @import("types.zig").ForkEntry;
const request_policy = @import("reqresp/request_policy.zig");

pub const ReqRespOverrides = struct {
    outbound_max: ?u16 = null,
    serving_max: ?u16 = null,
    serving_per_source_max: ?u8 = null,
    outbound_per_connection_max: ?u8 = null,
    inbound_per_connection_max: ?u8 = null,
    progress_timeout_ms: ?u64 = null,
    host_timeout_ms: ?u64 = null,
    quota_timeout_ms: ?u64 = null,
    work_per_pump_max: ?u16 = null,
};
pub const IdentifyOverrides = struct {
    inbound_max: ?u16 = null,
    outbound_max: ?u16 = null,
    agent: ?[]const u8 = null,
    protocol_version: ?[]const u8 = null,
    addresses: ?@FieldType(identify_mod.Handler.Options, "addresses") = null,
};
pub const RouterOverrides = struct {
    capabilities: ?@FieldType(Router.Options, "capabilities") = null,
    negotiations_max: ?u16 = null,
    outbound_reserved: ??u16 = null,
    inbound_per_connection_max: ?u16 = null,
    meshsub_versions: ?@FieldType(Router.Options, "meshsub_versions") = null,
};

/// Shared capacities derive from the peer and transport limits.
pub const Options = struct {
    seed: u64,
    forks: []const ForkEntry,
    limits: ?Engine.Limits = null,
    work_limits: Transport.WorkLimits = .{},
    socket_buffers: SocketBuffers = .{},
    peers: ?peers.Catalog.Options = null,
    dial: ?peers.Dialing.Options = null,
    reqresp: ReqRespOverrides = .{},
    gossip: gossip.Options = .{},
    router: RouterOverrides = .{},
    identify: IdentifyOverrides = .{},
    application_requests_max: ?u16 = null,
    admission_policy: request_policy.Config,
    control: ?peers.Control.Options = null,
    byte_limit: ?usize = null,
};
/// NetworkCore's peer policy and protocol options.
pub const Core = struct {
    peers: peers.Catalog.Options = .{},
    protocols: Protocols.Options,
    control: peers.Control.Options = .{},
    dial: peers.Dialing.Options,
    metadata_freshness_ms: u64 = 60_000,

    /// The part of the options peer policy owns.
    pub fn peerManager(self: *const Core) peer_manager.Options {
        return .{ .peers = self.peers, .control = self.control, .dial = self.dial, .metadata_freshness_ms = self.metadata_freshness_ms };
    }
};
pub const Resolved = struct {
    limits: Engine.Limits,
    work_limits: Transport.WorkLimits,
    socket_buffers: SocketBuffers,
    core: Core,
    byte_limit: usize,
};

const outbound_reserved_max: u16 = 4;

pub fn resolve(options: Options) !Resolved {
    try options.work_limits.validate();
    try options.socket_buffers.validate();
    var limits: Engine.Limits = options.limits orelse .{
        .connections_max = 128,
        .handshaking_max = 32,
        .dialing_max = 32,
        .receive_budget_bytes = 512 * 1024 * 1024,
    };
    const peer_options: peers.Catalog.Options = options.peers orelse .{
        .capacity = 512,
        .outbound_reserve = 32,
        .target_peers = 64,
        .max_peers = 96,
        .min_outbound = 16,
    };
    try peer_options.validate();
    if (peer_options.target_peers >= peer_options.max_peers) return error.InvalidOptions;
    const dial_options = options.dial orelse peers.Dialing.Options{
        .capacity = 256,
        .concurrent_max = limits.dialing_max,
        .outbound_reserved = @min(outbound_reserved_max, limits.dialing_max, peer_options.max_peers - peer_options.target_peers),
        .seed = options.seed,
    };
    try peers.Dialing.validateOptions(dial_options);
    if (dial_options.concurrent_max != limits.dialing_max) return error.InvalidOptions;
    limits.outbound_reserved = dial_options.outbound_reserved;
    limits.outbound_max = limits.connections_max;
    var requests: rr.Options = .{
        .forks = options.forks,
        .connections = limits.connections_max,
        .protocols = .application,
        .outbound_max = 56,
        .serving_max = 56,
        .outbound_per_connection_max = 8,
        .inbound_per_connection_max = 8,
        .admission = undefined,
    };
    applyOverrides(&requests, options.reqresp);
    if (options.application_requests_max) |maximum| {
        if (maximum == 0) return error.InvalidOptions;
        requests.serving_max = @min(maximum, requests.serving_max);
        requests.outbound_max = @min(maximum, requests.outbound_max);
    }
    requests.admission = try rr.Options.Admission.defaults(&options.admission_policy, @max(1, requests.serving_max / 4));
    var control_requests: rr.Options = .{
        .forks = options.forks,
        .connections = limits.connections_max,
        .protocols = .control,
        .routes = .control,
        .report_non_completion = false,
        .outbound_max = peer_options.max_peers,
        .serving_max = 0,
        .serving_per_source_max = 0,
        .outbound_per_connection_max = 1,
        .inbound_per_connection_max = 8,
        .progress_timeout_ms = requests.progress_timeout_ms,
        .host_timeout_ms = requests.host_timeout_ms,
        .quota_timeout_ms = requests.quota_timeout_ms,
        .work_per_pump_max = 32,
        .admission = try rr.Options.Admission.defaults(&options.admission_policy, peer_options.max_peers),
    };
    control_requests.admission.scope = .peer;
    var identify: identify_mod.Handler.Options = .{ .inbound_max = 4, .outbound_max = 4 };
    applyOverrides(&identify, options.identify);
    var router_options: Router.Options = .{
        .negotiations_max = peer_options.max_peers + 248,
        .outbound_control_reserved = control_requests.outbound_max,
        .outbound_reserved = peer_options.max_peers + 64,
        .inbound_connections = limits.connections_max,
        .inbound_per_connection_max = @as(u16, requests.inbound_per_connection_max) + control_requests.inbound_per_connection_max + rr.outbound_stream_headroom,
    };
    applyOverrides(&router_options, options.router);
    var gossip_options = options.gossip;
    gossip_options.random_seed = options.seed;
    gossip_options.connected_capacity = peer_options.max_peers;
    gossip_options.connection_slots = limits.connections_max;
    gossip_options.retained_capacity = @max(peer_options.capacity, try @import("gossipsub/peer_book.zig").PeerBook.retainedCapacity(peer_options.max_peers, peer_options.outbound_reserve));
    gossip_options.retained_outbound_reserve = peer_options.outbound_reserve;
    const result: Resolved = .{
        .limits = limits,
        .work_limits = options.work_limits,
        .socket_buffers = options.socket_buffers,
        .byte_limit = options.byte_limit orelse 512 * 1024 * 1024,
        .core = .{
            .peers = peer_options,
            .dial = dial_options,
            .control = options.control orelse .{},
            .protocols = .{
                .identify = identify,
                .router = router_options,
                .reqresp = requests,
                .control_reqresp = control_requests,
                .gossipsub = gossip_options,
            },
        },
    };
    try validate(result.limits, result.core);
    if (result.limits.connections_max > c.peers_cap)
        return error.InvalidOptions;
    return result;
}

pub fn validate(limits: Engine.Limits, options: Core) !void {
    try limits.validate();
    try peer_manager.PeerManager.validateOptions(options.peerManager());
    try Protocols.validateOptions(options.protocols);
    if (options.peers.max_peers > limits.connections_max or
        options.protocols.reqresp.connections < limits.connections_max or
        options.protocols.control_reqresp.connections < limits.connections_max or
        options.protocols.gossipsub.connection_slots < limits.connections_max or
        options.dial.concurrent_max != limits.dialing_max or
        options.dial.outbound_reserved != limits.outbound_reserved or
        limits.outbound_max != limits.connections_max or
        options.protocols.control_reqresp.outbound_max < options.peers.max_peers or
        options.protocols.router.outbound_control_reserved < options.protocols.control_reqresp.outbound_max)
        return error.InvalidOptions;
}

fn applyOverrides(options: anytype, overrides: anytype) void {
    inline for (std.meta.fields(@TypeOf(overrides))) |field| {
        if (@field(overrides, field.name)) |value| @field(options, field.name) = value;
    }
}

test {
    _ = @import("configuration_test.zig");
}

const mib = 1024 * 1024;

/// Kernel buffer sizes requested for each UDP socket role. The kernel default of 208 KiB holds
/// about 20 ms of traffic at 8,000 datagrams/s, so a longer owner pause drops datagrams. Linux
/// caps a request at net.core.rmem_max or wmem_max and doubles it: at a 16 MiB rmem_max, the QUIC
/// receive buffer holds about 14,560 datagrams at a truesize of 2,304 bytes.
pub const SocketBuffers = struct {
    quic: udp.Sockets.Buffers = .{ .receive = 16 * mib, .send = 4 * mib },
    discovery: udp.Sockets.Buffers = .{ .receive = 2 * mib, .send = 1 * mib },

    pub fn validate(self: SocketBuffers) error{InvalidLimits}!void {
        if (!self.quic.valid() or !self.discovery.valid()) return error.InvalidLimits;
    }
};
