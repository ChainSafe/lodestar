//! The score_collection case: the cost of the owner's metrics export at 200 connected gossip peers,
//! and of the gossip score collection within it, which reads every peer's score once. A stale score
//! cache costs an evaluation that visits all of the peer's topic score cells, so the case reports
//! three occupancies, no topic state, a typical one (mesh on 8 topics and first deliveries on 32)
//! and every cell active, each with stale and then valid caches. The peers are gossip sessions
//! without transport connections.
const Now = @import("network").Now;
const std = @import("std");
const network = @import("network");
const config = @import("config");
const preset = @import("preset");

const gossip = network.gossipsub;
const ScorePopulations = gossip.metrics.ScorePopulations;
const chain_config = if (preset.active_preset == .minimal) &config.minimal.config else &config.mainnet.config;
const peers = 200;
const rounds = 200;

fn timestamp(io: std.Io) u64 {
    return @intCast(std.Io.Clock.awake.now(io).nanoseconds);
}

pub fn run(init: std.process.Init) !void {
    const allocator = init.gpa;
    const io = init.io;
    const network_config = try network.chain.Config.init(chain_config, false);
    const update = try network_config.update(.{ .metadata = .{ .custody_group_count = chain_config.chain.CUSTODY_REQUIREMENT } }, null, 0);
    const resolved = try network.configuration.resolve(.{
        .seed = 7,
        .limits = .{ .connections_max = 256, .handshaking_max = 32, .dialing_max = 32, .receive_budget_bytes = 512 * 1024 * 1024 },
        .peers = .{ .target_peers = peers, .max_peers = peers + 20, .min_outbound = peers / 4 },
        .byte_limit = 1024 * 1024 * 1024,
        .forks = network_config.forks[0..network_config.boundary_count],
        .admission_policy = network_config.requestPolicy(),
        .router = .{ .capabilities = update.capabilities },
        .gossip = .{ .topic_policy = network_config.topics[0..network_config.boundary_count], .message_id_policy = .{ .phase0_digest = network_config.phase0_digest }, .score_params = .{ .ip_colocation_weight = -53, .ip_colocation_threshold = 3 } },
    });
    const key = try network.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{13}));
    const unix_s: u64 = @intCast((try Now.read(io)).unixSeconds());
    const clock = try network.SlotClock.init(&chain_config.chain, unix_s - 100 * chain_config.chain.SECONDS_PER_SLOT);
    const node = try allocator.create(network.NetworkCore);
    defer allocator.destroy(node);
    try node.init(allocator, io, &resolved, .{ .host = &key, .bind = .{ .ip4 = .loopback(0) }, .local = update.local, .schedule = update.schedule, .clock = clock });
    defer node.deinit(io);
    const g = node.protocols.gossipsub;
    const topics_cap = g.overlay.rows.len;
    for (0..peers) |index| {
        var identity: network.PeerId = .{ .bytes = @splat(0) };
        std.mem.writeInt(u16, identity.bytes[0..2], @intCast(index + 1), .little);
        const address: network.Address = .{ .ip4 = .{ .octets = .{ 10, 0, @intCast(index >> 8), @intCast(index & 0xff) }, .port = 9000 } };
        const admitted = g.addPeer(.{ .index = @intCast(index), .generation = 1 }, &.{ .identity = identity, .address = address, .direction = .inbound }, Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 }));
        if (admitted != .admitted) return error.PeerAdmission;
    }
    const buffer = try allocator.alloc(u8, network.metrics.textCapacity(network_config.topics[0..network_config.boundary_count]));
    defer allocator.free(buffer);
    std.debug.print("case=score_collection preset={s} optimize={s} peers={} topic_cells_per_peer={} rounds={}\n", .{ @tagName(preset.active_preset), @tagName(@import("builtin").mode), peers, topics_cap, rounds });
    for ([_]struct { []const u8, usize, usize }{ .{ "empty", 0, 0 }, .{ "typical", 8, 32 }, .{ "full", @min(topics_cap, gossip.constants.topics_cap), topics_cap } }) |level| {
        for (g.sessions.rows, 0..) |*session, index| {
            if (!session.active) continue;
            const peer = session.logical.index;
            for (0..level[1]) |offset| {
                const topic: u16 = @intCast((index + offset) % topics_cap);
                g.peers.scores.graft(peer, topic, 0);
                g.overlay.rows[topic].mesh.set(index);
            }
            for (0..level[2]) |offset| g.peers.scores.deliverEligible(peer, @intCast((index + offset) % topics_cap), false);
        }
        // First every score cache is stale, as after deliveries; then each holds a valid score, as
        // after the heartbeat or an RPC read it.
        for ([_][]const u8{ "stale", "valid" }) |caches| {
            if (std.mem.eql(u8, caches, "valid")) for (g.sessions.rows) |*session| {
                if (session.active) _ = g.peers.score(session.logical, 60_000);
            };
            var collect_ns: [rounds]u64 = undefined;
            var export_ns: [rounds]u64 = undefined;
            var connected: u64 = 0;
            var bytes: usize = 0;
            for (&collect_ns, &export_ns, 0..) |*collect_elapsed, *export_elapsed, round| {
                const now: network.types.Now = Now.fromMilliseconds(.{ .mono_ms = 60_000 + round, .unix_s = 1 });
                var start = timestamp(io);
                const populations = ScorePopulations.collect(&g.peers, g.overlay, g.sessions, now.millis());
                collect_elapsed.* = timestamp(io) - start;
                connected += populations.populations[0].peers[0];
                start = timestamp(io);
                var context = network.metrics.Context.init(node, now);
                var writer = std.Io.Writer.fixed(buffer);
                try network.metrics.write(&context, &writer);
                export_elapsed.* = timestamp(io) - start;
                bytes = writer.buffered().len;
            }
            std.mem.sort(u64, &collect_ns, {}, std.sort.asc(u64));
            std.mem.sort(u64, &export_ns, {}, std.sort.asc(u64));
            std.debug.print("case=score_collection occupancy={s} caches={s} mesh_topics={} delivery_topics={} collect_p50_us={d:.1} collect_p99_us={d:.1} collect_per_peer_ns={d:.0} export_p50_us={d:.1} export_p99_us={d:.1} export_bytes={} connected={}\n", .{ level[0], caches, level[1], level[2], micros(collect_ns[rounds / 2]), micros(collect_ns[rounds * 99 / 100]), @as(f64, @floatFromInt(collect_ns[rounds / 2])) / peers, micros(export_ns[rounds / 2]), micros(export_ns[rounds * 99 / 100]), bytes, connected / rounds });
        }
    }
}

fn micros(ns: u64) f64 {
    return @as(f64, @floatFromInt(ns)) / 1000;
}
