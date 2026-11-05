const policy_fixture = @import("reqresp/policy_fixture.zig");
const topic_fixture = @import("gossipsub/topic_fixture.zig");
const rr = @import("reqresp/ReqResp.zig");
const std = @import("std");
const Transport = @import("transport.zig").Transport;
const udp = @import("udp");
const validate = @import("configuration.zig").validate;
const protocol = @import("reqresp/protocol.zig");
const ForkEntry = @import("types.zig").ForkEntry;
const configuration = @import("configuration.zig");
const gossip_limits = @import("gossip_limits.zig");
const gossip_options = @import("gossipsub/options.zig");

test "configuration preserves gossip storage derived from payload limits in different peer capacities" {
    const mib = 1024 * 1024;
    for ([_]u16{ 96, 200 }) |max_peers| {
        const defaults = try resolve(.{ .limits = .{ .connections_max = 232 }, .peers = .{ .capacity = 512, .target_peers = max_peers - 4, .max_peers = max_peers }, .seed = 1, .forks = &.{}, .admission_policy = policy_fixture.config() });
        try std.testing.expectEqual(@as(usize, 1024), defaults.core.protocols.gossipsub.validation_capacity);
        try std.testing.expectEqual(@as(usize, 64 * mib), defaults.core.protocols.gossipsub.mcache_arena_bytes);
        for ([_]u32{ 4096, mib }) |bytes| {
            const limits: gossip_limits.Limits = @splat(.{ .items = 2, .bytes = bytes });
            var request: configuration.Options = .{
                .limits = .{ .connections_max = 232 },
                .peers = .{ .capacity = 512, .target_peers = max_peers - 4, .max_peers = max_peers },
                .seed = 1,
                .forks = &.{},
                .admission_policy = policy_fixture.config(),
                .gossip = .{ .topic_policy = &.{topic_fixture.full(@splat(0))} },
            };
            try request.gossip.setPayloadLimits(&limits);
            const resolved = try resolve(request);
            const options = resolved.core.protocols.gossipsub;
            try std.testing.expectEqual(@as(usize, 2 * gossip_limits.kind_count), options.validation_capacity);
            try std.testing.expectEqual(@as(usize, if (bytes == 4096) gossip_options.mcache_arena_bytes_min else 2 * gossip_limits.kind_count * mib), options.mcache_arena_bytes);
            try std.testing.expectEqualDeep(limits, options.payload_limits.?);
            try std.testing.expectEqual(defaults.core.protocols.gossipsub.mcache_capacity, options.mcache_capacity);
            try std.testing.expectEqual(defaults.core.protocols.gossipsub.receive_arena_bytes, options.receive_arena_bytes);

            request.gossip.mcache_arena_bytes = 64 * mib;
            try std.testing.expectEqual(@as(usize, 64 * mib), (try resolve(request)).core.protocols.gossipsub.mcache_arena_bytes);
            request.gossip.validation_capacity = 2 * gossip_limits.kind_count - 1;
            try std.testing.expectError(error.InvalidLimits, resolve(request));
            request.gossip.validation_capacity = 2 * gossip_limits.kind_count;
            request.gossip.mcache_arena_bytes = gossip_options.mcache_arena_bytes_min - 1;
            try std.testing.expectError(error.InvalidLimits, resolve(request));
        }
        const invalid: gossip_limits.Limits = @splat(.{ .items = 1, .bytes = 4096 });
        try std.testing.expectError(error.InvalidLimits, resolve(.{
            .limits = .{ .connections_max = 232 },
            .peers = .{ .capacity = 512, .target_peers = max_peers - 4, .max_peers = max_peers },
            .seed = 1,
            .forks = &.{},
            .admission_policy = policy_fixture.config(),
            .gossip = .{ .payload_limits = invalid },
        }));
    }
}

test "configuration resolves dial concurrency independently of peer headroom" {
    for ([_]u16{ 1, 2, 10 }) |headroom| {
        const resolved = try resolve(.{
            .seed = 1,
            .forks = &.{},
            .limits = .{ .connections_max = 242, .handshaking_max = 32, .dialing_max = 32 },
            .peers = .{ .capacity = 512, .target_peers = 200, .max_peers = 200 + headroom, .min_outbound = 50 },
            .admission_policy = policy_fixture.config(),
        });
        const reserved = @min(headroom, 4);
        try std.testing.expectEqual(@as(u16, 32), resolved.core.dial.concurrent_max);
        try std.testing.expectEqual(@as(u16, 32), resolved.limits.dialing_max);
        try std.testing.expectEqual(reserved, resolved.core.dial.outbound_reserved);
        try std.testing.expectEqual(reserved, resolved.limits.outbound_reserved);
        try std.testing.expectEqual(@as(?u16, 242), resolved.limits.outbound_max);
        try std.testing.expectEqual(@as(u16, 0), resolved.core.protocols.control_reqresp.serving_max);
    }
    const beacon = try resolve(.{ .seed = 1, .forks = &.{}, .admission_policy = policy_fixture.config() });
    try std.testing.expectEqual(@as(u16, 32), beacon.core.dial.concurrent_max);
    try std.testing.expectError(error.InvalidOptions, resolve(.{
        .seed = 1,
        .forks = &.{},
        .limits = .{ .dialing_max = 16 },
        .dial = .{ .seed = 1, .concurrent_max = 8 },
        .admission_policy = policy_fixture.config(),
    }));
    try std.testing.expectError(error.InvalidOptions, resolve(.{
        .seed = 1,
        .forks = &.{},
        .limits = .{ .dialing_max = 65 },
        .admission_policy = policy_fixture.config(),
    }));
    try std.testing.expectError(error.InvalidOptions, resolve(.{
        .seed = 1,
        .forks = &.{},
        .peers = .{ .target_peers = 96, .max_peers = 96 },
        .admission_policy = policy_fixture.config(),
    }));
}

test "configuration control admission quotas permit the full two hundred peer workload" {
    const resolved = try resolve(.{
        .seed = 1,
        .forks = &.{},
        .peers = .{ .capacity = 512, .target_peers = 190, .max_peers = 200, .min_outbound = 50 },
        .limits = .{ .connections_max = 232 },
        .application_requests_max = 32,
        .admission_policy = policy_fixture.config(),
    });
    const requests = resolved.core.protocols.control_reqresp;
    const quotas = requests.admission.limits;
    const admission = @import("reqresp/admission.zig");
    try std.testing.expectEqual(.peer, requests.admission.scope);
    var owner = try @import("reqresp/ReqResp.zig").init(std.testing.allocator, requests);
    defer owner.deinit();
    const starts = &owner.admission.limiter;
    for (std.enums.values(protocol.Protocol)) |which| {
        if (!which.isControl()) continue;
        const quota = quotas.source.get(which, .fulu);
        try std.testing.expectEqual(quota.tokens * 200, quotas.global.get(which, .fulu).tokens);
        for (0..200) |index| {
            const identity: @import("wire/peer_id.zig").PeerId = .{ .bytes = @splat(@as(u8, @intCast(index))) };
            const conn: @import("types.zig").Handle = .{ .index = @intCast(index), .generation = 1 };
            const endpoint: @import("udp").Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, @intCast(index) }, .port = 1 } };
            owner.connectionOpened(conn, &identity, &endpoint, @import("types.zig").Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 }));
            const row = owner.admission.sourceRow(conn);
            try std.testing.expectEqual(admission.Decision.allowed, starts.start(row, 0));
            try std.testing.expectEqual(admission.Decision.allowed, starts.take(row, which, quota.tokens, .fulu, 0));
            try std.testing.expectEqual(admission.Decision.source_quota, starts.take(row, which, 1, .fulu, 0));
        }
    }
}

test "configuration overrides derive shared capacities from their owners" {
    const forks: []const ForkEntry = &.{.{ .digest = @splat(1), .fork = .fulu }};
    const resolved = try resolve(.{
        .seed = 17,
        .forks = forks,
        .limits = .{ .connections_max = 8, .handshaking_max = 4, .dialing_max = 2 },
        .peers = .{ .capacity = 24, .outbound_reserve = 3, .max_peers = 6, .target_peers = 4, .min_outbound = 1 },
        .reqresp = .{ .work_per_pump_max = 7, .outbound_max = 12 },
        .gossip = .{ .validation_capacity = 16 },
        .router = .{ .negotiations_max = 20, .outbound_reserved = 8 },
        .admission_policy = policy_fixture.config(),
    });
    const protocols = &resolved.core.protocols;
    try std.testing.expectEqual(resolved.limits.connections_max, protocols.reqresp.connections);
    try std.testing.expectEqual(resolved.limits.connections_max, protocols.control_reqresp.connections);
    try std.testing.expectEqual(resolved.core.peers.max_peers, protocols.control_reqresp.outbound_max);
    try std.testing.expectEqualSlices(ForkEntry, forks, protocols.reqresp.forks);
    try std.testing.expectEqual(@as(u16, 12), protocols.reqresp.outbound_max);
    try std.testing.expectEqual(@as(u16, 7), protocols.reqresp.work_per_pump_max);
    try std.testing.expectEqual(@as(u16, 0), protocols.control_reqresp.serving_max);
    try std.testing.expectEqual(@as(u16, 6), protocols.router.outbound_control_reserved);
    try std.testing.expectEqual(@as(u16, 20), protocols.router.negotiations_max);
    try std.testing.expectEqual(@as(u16, 6), protocols.gossipsub.connected_capacity);
    try std.testing.expectEqual(@as(u16, 24), protocols.gossipsub.retained_capacity);
    try std.testing.expectEqual(@as(u16, 3), protocols.gossipsub.retained_outbound_reserve);
    try std.testing.expectEqual(@as(?u64, 17), protocols.gossipsub.random_seed);
    try std.testing.expectEqual(@as(usize, 16), protocols.gossipsub.validation_capacity);
    try std.testing.expectEqual(@as(u16, 2), resolved.core.dial.concurrent_max);
}

test "configuration rejects inconsistent capacity sections before owners" {
    const resolved = try resolve(.{ .seed = 1, .forks = &.{}, .admission_policy = policy_fixture.config() });
    var options = resolved.core;
    options.protocols.router.outbound_control_reserved += 1;
    try validate(resolved.limits, options);
    options = resolved.core;
    options.protocols.reqresp.serving_max = 0;
    try std.testing.expectError(error.InvalidOptions, validate(resolved.limits, options));
    options = resolved.core;
    options.protocols.router.outbound_control_reserved = 0;
    try std.testing.expectError(error.InvalidOptions, validate(resolved.limits, options));
    options = resolved.core;
    options.protocols.control_reqresp.outbound_max = options.peers.max_peers - 1;
    try std.testing.expectError(error.InvalidOptions, validate(resolved.limits, options));
    options = resolved.core;
    options.protocols.reqresp.connections = resolved.limits.connections_max - 1;
    try std.testing.expectError(error.InvalidOptions, validate(resolved.limits, options));
    options = resolved.core;
    options.peers.max_peers = resolved.limits.connections_max + 1;
    try std.testing.expectError(error.InvalidOptions, validate(resolved.limits, options));
    options = resolved.core;
    options.protocols.gossipsub.retained_capacity = options.protocols.gossipsub.connected_capacity - 1;
    try std.testing.expectError(error.InvalidLimits, validate(resolved.limits, options));
    options = resolved.core;
    options.protocols.gossipsub.retained_outbound_reserve = options.protocols.gossipsub.retained_capacity;
    try std.testing.expectError(error.InvalidLimits, validate(resolved.limits, options));
    options = resolved.core;
    options.protocols.gossipsub.connected_capacity = 0;
    try std.testing.expectError(error.InvalidLimits, validate(resolved.limits, options));
    var limits = resolved.limits;
    limits.dialing_max = resolved.core.dial.concurrent_max - 1;
    try std.testing.expectError(error.InvalidOptions, validate(limits, resolved.core));
}

test "configuration request admission memory plan measures retained capacity" {
    for ([_]u16{ 96, 200 }) |max_peers| {
        const resolved = try resolve(.{ .limits = .{ .connections_max = 232 }, .peers = .{ .capacity = 512, .target_peers = max_peers - 4, .max_peers = max_peers }, .seed = 1, .forks = &.{}, .admission_policy = policy_fixture.config() });
        var allocator = std.testing.FailingAllocator.init(std.testing.allocator, .{});
        var handler = try rr.init(allocator.allocator(), resolved.core.protocols.reqresp);
        defer handler.deinit();
        var control = try rr.init(allocator.allocator(), resolved.core.protocols.control_reqresp);
        defer control.deinit();
        const plan = handler.memoryPlan();
        const control_plan = control.memoryPlan();
        try std.testing.expectEqual(allocator.allocated_bytes, plan.total_bytes - plan.facade_bytes + control_plan.total_bytes - control_plan.facade_bytes);
    }
}

test "configuration preserves independent transport work limits" {
    const limits: Transport.WorkLimits = .{ .send_per_turn_max = 3, .receive_per_turn_max = 2, .burst_per_connection = 2 };
    const resolved = try resolve(.{ .seed = 1, .forks = &.{}, .work_limits = limits, .admission_policy = policy_fixture.config() });
    try std.testing.expectEqual(limits, resolved.work_limits);
    try std.testing.expectError(error.InvalidLimits, resolve(.{ .seed = 1, .forks = &.{}, .work_limits = .{ .send_per_turn_max = 0 }, .admission_policy = policy_fixture.config() }));
}

test "configuration carries bounded UDP socket buffer requests" {
    const bounds: configuration.SocketBuffers = .{
        .quic = .{ .receive = udp.Sockets.Buffers.bytes_max, .send = udp.Sockets.Buffers.bytes_min },
        .discovery = .{ .receive = udp.Sockets.Buffers.bytes_min, .send = udp.Sockets.Buffers.bytes_max },
    };
    try std.testing.expectEqual(bounds, (try resolve(.{ .seed = 1, .forks = &.{}, .socket_buffers = bounds, .admission_policy = policy_fixture.config() })).socket_buffers);
    const invalid = [_]configuration.SocketBuffers{
        .{ .quic = .{ .receive = udp.Sockets.Buffers.bytes_min - 1, .send = udp.Sockets.Buffers.bytes_min } },
        .{ .quic = .{ .receive = udp.Sockets.Buffers.bytes_min, .send = udp.Sockets.Buffers.bytes_max + 1 } },
        .{ .discovery = .{ .receive = udp.Sockets.Buffers.bytes_max + 1, .send = udp.Sockets.Buffers.bytes_min } },
        .{ .discovery = .{ .receive = udp.Sockets.Buffers.bytes_min, .send = udp.Sockets.Buffers.bytes_min - 1 } },
    };
    for (invalid) |socket_buffers| {
        try std.testing.expectError(error.InvalidLimits, resolve(.{ .seed = 1, .forks = &.{}, .socket_buffers = socket_buffers, .admission_policy = policy_fixture.config() }));
    }
}

test "resolved admission and Identify overrides use final capacities" {
    const resolved = try resolve(.{
        .seed = 91,
        .forks = &.{},
        .reqresp = .{ .serving_max = 256 },
        .admission_policy = policy_fixture.config(),
        .identify = .{ .agent = "resolved-agent", .protocol_version = "resolved-version" },
    });
    const requests = resolved.core.protocols.reqresp;
    const quotas = requests.admission.limits;
    const control_quotas = resolved.core.protocols.control_reqresp.admission.limits;
    try std.testing.expectEqual(quotas.starts.tokens * (requests.serving_max / 4), quotas.global_starts.tokens);
    try std.testing.expectEqual(@as(u32, resolved.core.peers.max_peers) * control_quotas.source.get(.ping_v1, .fulu).tokens, control_quotas.global.get(.ping_v1, .fulu).tokens);
    const identify = resolved.core.protocols.identify;
    try std.testing.expectEqualStrings("resolved-agent", identify.agent);
    try std.testing.expectEqualStrings("resolved-version", identify.protocol_version);
}

test "application request limits preserve control capacity and size admission from final limits" {
    for ([_]u16{ 96, 200 }) |max_peers| {
        const resolved = try resolve(.{
            .limits = .{ .connections_max = 232 },
            .peers = .{ .capacity = 512, .target_peers = max_peers - 4, .max_peers = max_peers },
            .seed = 91,
            .forks = &.{},
            .application_requests_max = 32,
            .admission_policy = policy_fixture.config(),
        });
        const requests = resolved.core.protocols.reqresp;
        const application_max: u16 = 32;
        try std.testing.expectEqual(application_max, requests.serving_max);
        try std.testing.expectEqual(application_max, requests.outbound_max);
        try std.testing.expectEqual(resolved.core.peers.max_peers, resolved.core.protocols.control_reqresp.outbound_max);
        const ping = resolved.core.protocols.control_reqresp.admission.limits.global.get(.ping_v1, .fulu);
        try std.testing.expectEqual(@as(u32, resolved.core.peers.max_peers) * resolved.core.protocols.control_reqresp.admission.limits.source.get(.ping_v1, .fulu).tokens, ping.tokens);
    }
    try std.testing.expectError(error.InvalidOptions, resolve(.{ .seed = 1, .forks = &.{}, .application_requests_max = 0, .admission_policy = policy_fixture.config() }));
    const smaller = try resolve(.{ .seed = 1, .forks = &.{}, .application_requests_max = 32, .reqresp = .{ .serving_max = 1 }, .admission_policy = policy_fixture.config() });
    try std.testing.expectEqual(@as(u16, 1), smaller.core.protocols.reqresp.serving_max);
}

test "configuration rejects invalid complete sections" {
    const forks: []const ForkEntry = &.{.{ .digest = @splat(0), .fork = .phase0 }};
    inline for (.{ error.InvalidOptions, error.InvalidOptions, error.InvalidOptions, error.InvalidLimits, error.InvalidLimits, error.InvalidOptions, error.InvalidLimits }, 0..) |expected, section| {
        var request: configuration.Options = .{ .seed = 1, .forks = forks, .admission_policy = policy_fixture.config() };
        switch (section) {
            0 => request.reqresp.work_per_pump_max = 0,
            1 => request.control = .{ .ping_inbound_ms = 0 },
            2 => request.dial = .{ .seed = 1, .concurrent_max = 0 },
            3 => request.gossip.score_params = .{ .decay_interval_ms = 0 },
            4 => request.limits = .{ .handshaking_max = 0 },
            5 => request.peers = .{ .capacity = 0 },
            6 => request.router = .{ .negotiations_max = 2 },
            else => unreachable,
        }
        try std.testing.expectError(expected, resolve(request));
    }
}

fn resolve(options: configuration.Options) !configuration.Resolved {
    var configured = options;
    if (configured.gossip.topic_policy.len == 0) configured.gossip.topic_policy = comptime &.{topic_fixture.bytes(@splat(0))};
    return configuration.resolve(configured);
}

test "configuration preserves live gossip admission at hosted peer capacities" {
    for ([_]u16{ 210, 256 }) |peers| {
        const resolved = try resolve(.{
            .limits = .{ .connections_max = 256 },
            .peers = .{ .capacity = 2 * peers, .target_peers = peers - 10, .max_peers = peers, .outbound_reserve = 32 },
            .seed = 1,
            .forks = &.{},
            .admission_policy = policy_fixture.config(),
        });
        const options = resolved.core.protocols.gossipsub;
        try std.testing.expectEqual(peers * 2 + 64, options.retained_capacity);
        try std.testing.expectEqual(peers + 32, try @import("gossipsub/peer_book.zig").PeerBook.pinLimit(options.retained_capacity, peers, options.retained_outbound_reserve));
    }
}
