const std = @import("std");
const config = @import("config");
const preset = @import("preset");
const p = preset.preset;
const application = @import("application_state.zig");
const chain_mod = @import("chain.zig");
const configuration = @import("configuration.zig");
const NetworkCore = @import("network_core.zig").NetworkCore;
const support = @import("network_core_test_support.zig");
const KeyPair = @import("wire/keys.zig").KeyPair;
const SlotClock = @import("slot_clock.zig").SlotClock;
const Now = @import("time.zig").Now;
const topic_mod = @import("gossipsub/topic.zig");
const Kind = topic_mod.Kind;
const a = std.testing.allocator;

const Fixture = struct {
    core: NetworkCore = undefined,
    chain: chain_mod.Config,
    state: application.State = undefined,

    fn create(options: application.Options) !*Fixture {
        return createWithKey(options, 1, 20);
    }
    fn createWithKey(options: application.Options, secret: u8, unsupported_epoch: u64) !*Fixture {
        const self = try a.create(Fixture);
        errdefer a.destroy(self);
        const base = if (preset.active_preset == .minimal) config.minimal.chain_config else config.mainnet.chain_config;
        const beacon = config.BeaconConfig.init(base.merge(.{
            .ALTAIR_FORK_EPOCH = 0,
            .BELLATRIX_FORK_EPOCH = 0,
            .CAPELLA_FORK_EPOCH = 0,
            .DENEB_FORK_EPOCH = 0,
            .ELECTRA_FORK_EPOCH = 0,
            .FULU_FORK_EPOCH = 4,
            .GLOAS_FORK_EPOCH = unsupported_epoch,
            .HEZE_FORK_EPOCH = unsupported_epoch,
            .BLOB_SCHEDULE = &.{.{ .EPOCH = 8, .MAX_BLOBS_PER_BLOCK = 9 }},
            .SLOT_DURATION_MS = 12000,
        }), @splat(0));
        self.* = .{ .chain = try chain_mod.Config.init(&beacon, false) };
        var opts = support.options();
        opts.forks = self.chain.forks[0..self.chain.boundary_count];
        opts.gossip.topic_policy = self.chain.topics[0..self.chain.boundary_count];
        opts.admission_policy = self.chain.requestPolicy();
        const local = support.localState(.{});
        const initial = try self.chain.update(local, null, 0);
        opts.router.capabilities = initial.capabilities;
        const resolved = try configuration.resolve(opts);
        const key = try KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{secret}));
        try self.core.init(a, std.testing.io, &resolved, .{ .host = &key, .bind = .{ .ip4 = .loopback(0) }, .local = initial.local, .schedule = initial.schedule, .clock = try SlotClock.init(&beacon.chain, 1_000_000) });
        errdefer self.core.deinit(std.testing.io);
        const cfg = try application.Config.init(&beacon.chain, options);
        self.state = try application.State.init(&cfg, &self.chain, &self.core.peerId(), &local);
        return self;
    }
    fn destroy(self: *Fixture) void {
        self.core.deinit(std.testing.io);
        a.destroy(self);
    }
    fn advance(self: *Fixture, slot: i64) !void {
        try self.state.advance(&self.core, &self.chain, now(slot));
    }
    fn apply(self: *Fixture, update: *const application.Update, slot: i64) !void {
        _ = try self.state.apply(&self.core, &self.chain, update, now(slot));
    }
    fn subscribed(self: *Fixture, boundary: usize, kind: Kind, subnet: u16) bool {
        const g = self.core.protocols.gossipsub;
        var bytes: [topic_mod.topic_max_len]u8 = undefined;
        const name = topic_mod.buildCanonical(.{ .digest = self.chain.boundaries[boundary].digest, .name = .{ .kind = kind, .subnet = subnet } }, &bytes);
        const index = g.overlay.findTopic(name) orelse return false;
        return g.overlay.subscribed(index);
    }
};
fn now(slot: i64) Now {
    return Now.fromMilliseconds(.{ .mono_ms = 1_000_000, .unix_s = 1_000_000 + slot * 12 });
}

test "application clock expires duties and preserves committed state through wall clock regression" {
    const f = try Fixture.create(.{});
    defer f.destroy();
    try f.advance(0);
    const subnet: u6 = @intCast(@ctz(~f.state.long_lived));
    const bit = @as(u64, 1) << subnet;
    var update: application.Update = .{ .core_topics = true, .attester_count = 1, .sync_until = .{ null, 2, null, null } };
    update.attesters[0] = .{ .slot = 2, .subnets = bit, .aggregators = bit };
    try f.apply(&update, 0);
    try std.testing.expect(f.subscribed(0, .beacon_attestation, subnet));
    try std.testing.expect(f.subscribed(0, .sync_committee, 1));
    try std.testing.expectEqual(f.state.long_lived, std.mem.readInt(u64, &f.core.localState().metadata.attnets, .little));
    try f.advance(3);
    try std.testing.expect(!f.subscribed(0, .beacon_attestation, subnet));
    try std.testing.expect(f.core.peer_manager.demand.attnets & bit != 0);
    try f.advance(4);
    try std.testing.expect(f.core.peer_manager.demand.attnets & bit == 0);
    try f.advance(p.SLOTS_PER_EPOCH);
    try std.testing.expectEqual(0, f.core.localState().metadata.syncnets);
    try f.advance(0);
    try std.testing.expectEqual(p.SLOTS_PER_EPOCH, try f.core.clock.read(now(0)));
    try std.testing.expect(!f.subscribed(0, .sync_committee, 1));
    const before = f.core.localState();
    update.custody_group_count = 0;
    try std.testing.expectError(error.InvalidCustodyCount, f.state.apply(&f.core, &f.chain, &update, now(p.SLOTS_PER_EPOCH)));
    try std.testing.expectEqualDeep(before, f.core.localState());
    update.custody_group_count = null;
    update.attesters[0].slot = 5 * p.SLOTS_PER_EPOCH;
    try std.testing.expectError(error.InvalidCommitteeDuty, f.state.apply(&f.core, &f.chain, &update, now(p.SLOTS_PER_EPOCH)));
    try std.testing.expectEqualDeep(before, f.core.localState());
}

test "application clock reconciles fork overlap and BPO after skipped slots" {
    const f = try Fixture.create(.{});
    defer f.destroy();
    try f.apply(&.{ .core_topics = true }, -3 * p.SLOTS_PER_EPOCH);
    try std.testing.expect(!f.subscribed(0, .beacon_block, 0));
    try f.advance(-2 * p.SLOTS_PER_EPOCH);
    try std.testing.expect(f.subscribed(0, .beacon_block, 0));
    try f.advance(p.SLOTS_PER_EPOCH);
    try std.testing.expect(!f.subscribed(1, .beacon_block, 0));
    try f.advance(2 * p.SLOTS_PER_EPOCH);
    try std.testing.expect(f.subscribed(0, .beacon_block, 0));
    try std.testing.expect(f.subscribed(1, .beacon_block, 0));
    try std.testing.expectEqual(.electra, f.core.localState().fork.fork);
    try f.advance(4 * p.SLOTS_PER_EPOCH);
    try std.testing.expectEqual(.fulu, f.core.localState().fork.fork);
    try std.testing.expectEqual(0, f.core.localState().status.head_slot);
    try f.advance(6 * p.SLOTS_PER_EPOCH);
    try std.testing.expect(!f.subscribed(0, .beacon_block, 0));
    try std.testing.expect(f.subscribed(2, .beacon_block, 0));
    try f.advance(15 * p.SLOTS_PER_EPOCH);
    try std.testing.expect(!f.subscribed(1, .beacon_block, 0));
    try std.testing.expect(f.subscribed(2, .beacon_block, 0));
    try std.testing.expectEqualDeep(f.chain.boundaries[2].digest, f.core.localState().fork.digest);
    try std.testing.expectError(error.UnsupportedNetworkFork, f.advance(20 * p.SLOTS_PER_EPOCH));
}

test "application keeps subscribe-all and custody subscriptions independent of core topics" {
    const f = try Fixture.create(.{ .subscribe_all_subnets = true });
    defer f.destroy();
    try f.apply(&.{ .core_topics = true, .custody_group_count = 1 }, 4 * p.SLOTS_PER_EPOCH);
    try f.apply(&.{ .core_topics = false }, 4 * p.SLOTS_PER_EPOCH);
    try std.testing.expect(!f.subscribed(1, .beacon_block, 0));
    for (0..64) |subnet| try std.testing.expect(f.subscribed(1, .beacon_attestation, @intCast(subnet)));
    for (0..4) |subnet| try std.testing.expect(f.subscribed(1, .sync_committee, @intCast(subnet)));
    try std.testing.expectEqual(@as(u64, std.math.maxInt(u64)), std.mem.readInt(u64, &f.core.localState().metadata.attnets, .little));
    for (0..preset.NUMBER_OF_COLUMNS) |column| {
        const selected = f.state.sampling.isSet(column % f.chain.custody_groups);
        try std.testing.expectEqual(selected, f.subscribed(1, .data_column_sidecar, @intCast(column)));
    }
}

// Generated from Lodestar's production subnet and custody formulas by test/utils/nativePolicyFixtures.ts.
test "application subscriptions match Lodestar across identities and long-lived rotations" {
    const Case = struct {
        secret: u8,
        node_id: [32]u8,
        epochs: []const struct { epoch: u64, subnets: []const u6 },
        custody: []const struct { count: u64, groups: []const u8, subnets: []const u8 },
    };
    const input = if (preset.active_preset == .mainnet) @embedFile("testdata/application_subnets_mainnet.json") else @embedFile("testdata/application_subnets_minimal.json");
    const parsed = try std.json.parseFromSlice([]Case, a, input, .{});
    defer parsed.deinit();
    for (parsed.value) |fixture| {
        const f = try Fixture.createWithKey(.{}, fixture.secret, std.math.maxInt(u64));
        defer f.destroy();
        try std.testing.expectEqual(fixture.node_id, f.state.node_id);
        for (fixture.epochs) |epoch| {
            try f.advance(@intCast(epoch.epoch * p.SLOTS_PER_EPOCH));
            var expected: u64 = 0;
            for (epoch.subnets) |subnet| expected |= @as(u64, 1) << subnet;
            try std.testing.expectEqual(expected, std.mem.readInt(u64, &f.core.localState().metadata.attnets, .little));
            for (0..64) |subnet| {
                try std.testing.expectEqual(expected & (@as(u64, 1) << @intCast(subnet)) != 0, f.subscribed(if (epoch.epoch < 6) 0 else 2, .beacon_attestation, @intCast(subnet)));
            }
        }
        for (fixture.custody) |custody| {
            try f.apply(&.{ .custody_group_count = custody.count }, 1024 * p.SLOTS_PER_EPOCH);
            const groups = try std.fmt.parseInt(u128, custody.groups, 16);
            const subnets = try std.fmt.parseInt(u128, custody.subnets, 16);
            for (0..f.chain.custody_groups) |group| {
                const expected = groups & (@as(u128, 1) << @intCast(group)) != 0;
                try std.testing.expectEqual(expected, f.state.sampling.isSet(group));
            }
            for (0..preset.NUMBER_OF_COLUMNS) |subnet| {
                const expected = subnets & (@as(u128, 1) << @intCast(subnet)) != 0;
                try std.testing.expectEqual(expected, f.subscribed(2, .data_column_sidecar, @intCast(subnet)));
            }
        }
    }
}

test "application admission allows next-epoch duties at the clock-disparity boundary" {
    _ = try application.Config.init(&config.mainnet.chain_config, .{ .aggregator_lead_slots = 2 * p.SLOTS_PER_EPOCH });
    try std.testing.expectError(error.InvalidNetworkConfig, application.Config.init(&config.mainnet.chain_config, .{ .aggregator_lead_slots = 2 * p.SLOTS_PER_EPOCH + 1 }));
    const f = try Fixture.create(.{});
    defer f.destroy();
    var update: application.Update = .{ .attester_count = 1 };
    update.attesters[0] = .{ .slot = 2 * p.SLOTS_PER_EPOCH, .subnets = 1, .aggregators = 1 };
    var tick = now(p.SLOTS_PER_EPOCH - 1);
    try std.testing.expectError(error.InvalidCommitteeDuty, f.state.apply(&f.core, &f.chain, &update, tick));
    tick.wall.raw.nanoseconds += 11_500 * std.time.ns_per_ms;
    _ = try f.state.apply(&f.core, &f.chain, &update, tick);
    try f.advance(2 * p.SLOTS_PER_EPOCH);
    try std.testing.expect(f.subscribed(0, .beacon_attestation, 0));
}

test "application initialization cannot reverse a fork already installed in the core" {
    const f = try Fixture.create(.{});
    defer f.destroy();
    try f.advance(4 * p.SLOTS_PER_EPOCH);
    f.state.applied_slot = null;
    try f.advance(0);
    try std.testing.expectEqual(.fulu, f.core.localState().fork.fork);
    try std.testing.expectEqual(4 * p.SLOTS_PER_EPOCH, f.state.applied_slot.?);
}

test "application retries unapplied slot state after a rejected host update" {
    const f = try Fixture.create(.{});
    defer f.destroy();
    try f.advance(0);
    const subnet: u6 = @intCast(@ctz(~f.state.long_lived));
    const bit = @as(u64, 1) << subnet;
    var update: application.Update = .{ .attester_count = 1 };
    update.attesters[0] = .{ .slot = 2, .subnets = bit, .aggregators = bit };
    try f.apply(&update, 0);
    try std.testing.expect(f.subscribed(0, .beacon_attestation, subnet));
    try std.testing.expectError(error.InvalidCustodyCount, f.apply(&.{ .custody_group_count = 0 }, 4));
    try std.testing.expectEqual(0, f.state.applied_slot.?);
    try f.advance(0);
    try std.testing.expectEqual(4, f.state.applied_slot.?);
    try std.testing.expect(!f.subscribed(0, .beacon_attestation, subnet));
    try std.testing.expectEqual(0, f.core.peer_manager.demand.attnets & bit);
}
