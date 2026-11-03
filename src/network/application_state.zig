//! Beacon-node subscriptions and peer demand, advanced by the serialized native owner.
const std = @import("std");
const config = @import("config");
const preset = @import("preset");
const p = preset.preset;
const constants = @import("constants");
const shuffle = @import("swap_or_not_shuffle");
const chain_mod = @import("chain.zig");
const local_state = @import("local_state.zig");
const custody = @import("peers/custody.zig");
const peers = @import("peers/types.zig");
const gossip = @import("gossipsub/local_intent.zig");
const topics = @import("gossipsub/topic_policy.zig");
const NetworkCore = @import("network_core.zig").NetworkCore;
const Endpoints = @import("advertisement.zig").Endpoints;
const Now = @import("time.zig").Now;

pub const duty_batch_max = 4 * p.SLOTS_PER_EPOCH;
const duty_slots = 2 * p.SLOTS_PER_EPOCH + 1;
pub const Attesters = struct { slot: u64, subnets: u64, aggregators: u64 };
pub const Update = struct {
    status: ?local_state.Status = null,
    core_topics: ?bool = null,
    custody_group_count: ?u64 = null,
    attesters: [duty_batch_max]Attesters = undefined,
    attester_count: u16 = 0,
    sync_until: [4]?u64 = @splat(null),
};
pub const Options = struct {
    subscribe_all_subnets: bool = false,
    aggregator_lead_slots: u64 = 2,
    target_group_peers: u16 = 6,
};
pub const Config = struct {
    subnets_per_node: u8,
    subnet_subscription_epochs: u64,
    options: Options,

    pub fn init(chain: *const config.ChainConfig, options: Options) !Config {
        if (chain.SUBNETS_PER_NODE > constants.ATTESTATION_SUBNET_COUNT or chain.EPOCHS_PER_SUBNET_SUBSCRIPTION == 0 or
            chain.EPOCHS_PER_SUBNET_SUBSCRIPTION > 9007199254740991 or options.aggregator_lead_slots > 2 * p.SLOTS_PER_EPOCH or
            options.target_group_peers == 0 or options.target_group_peers > 256) return error.InvalidNetworkConfig;
        return .{
            .subnets_per_node = @intCast(chain.SUBNETS_PER_NODE),
            .subnet_subscription_epochs = chain.EPOCHS_PER_SUBNET_SUBSCRIPTION,
            .options = options,
        };
    }
};

pub const State = struct {
    config: Config,
    node_id: [32]u8,
    /// Last successfully applied subscription state, which may lag the clock after a refused update.
    applied_slot: ?i64 = null,
    core_topics: bool = false,
    custody_topics: bool = false,
    custody_count: u64,
    sampling: custody.Groups,
    aggregators: [duty_slots]?Attesters = @splat(null),
    att_until: [64]?u64 = @splat(null),
    sync_until: [4]?u64 = @splat(null),
    subnet_period: ?u64 = null,
    long_lived: u64 = 0,

    pub fn init(cfg: *const Config, chain: *const chain_mod.Config, identity: *const peers.PeerId, local: *const local_state.LocalState) !State {
        if (chain.fulu_scheduled and local.status.earliest_available_slot == null) return error.MissingAvailability;
        const node_id = try custody.nodeId(identity);
        const count = local.metadata.custody_group_count orelse return error.InvalidCustodyCount;
        return .{ .config = cfg.*, .node_id = node_id, .custody_count = count, .sampling = try sampleGroups(&node_id, chain, count) };
    }

    fn sampleGroups(node_id: *const [32]u8, chain: *const chain_mod.Config, count: u64) !custody.Groups {
        if (count == 0) return error.InvalidCustodyCount;
        var derivation = try custody.SamplingDerivation.init(node_id, .{ .groups = chain.custody_groups, .columns = preset.NUMBER_OF_COLUMNS }, count, chain.sampling_groups);
        for (0..custody.hashes_max / custody.hashes_per_row + 1) |_| {
            if (try derivation.step(custody.hashes_per_row)) |result| return result.sampling;
        }
        unreachable;
    }

    /// Clock corrections never undo a committed fork or revive expired duties. Stalls skip to current state.
    pub fn advance(self: *State, core: *NetworkCore, chain: *const chain_mod.Config, now: Now) !void {
        if (try core.clock.read(now) == self.applied_slot) return;
        _ = try self.apply(core, chain, &.{}, now);
    }

    pub fn apply(self: *State, core: *NetworkCore, chain: *const chain_mod.Config, update: *const Update, now: Now) !bool {
        var next = self.*;
        const current = try core.clock.read(now);
        try next.merge(chain, update, current, try core.clock.futureSlot(now));
        var local = core.localState();
        if (update.status) |status| local.status = status;
        if (chain.fulu_scheduled and local.status.earliest_available_slot == null) return error.MissingAvailability;
        var subscriptions: [chain_mod.boundary_max]gossip.Boundary = undefined;
        const intent = try next.render(chain, &local, core.advertisementEndpoints(), core.peer_manager.catalog.options.max_peers, current, &subscriptions);
        const changed = try core.applyIntent(&intent, now);
        next.applied_slot = current;
        self.* = next;
        return changed;
    }

    fn merge(self: *State, chain: *const chain_mod.Config, update: *const Update, signed_slot: i64, future_slot: u64) !void {
        const current: u64 = @intCast(@max(0, signed_slot));
        const latest = (@max(current, future_slot) / p.SLOTS_PER_EPOCH + 2) * p.SLOTS_PER_EPOCH - 1;
        std.debug.assert(update.attester_count <= duty_batch_max);
        if (update.core_topics) |enabled| self.core_topics = enabled;
        if (update.custody_group_count) |count| {
            self.sampling = try sampleGroups(&self.node_id, chain, count);
            self.custody_count = count;
            self.custody_topics = true;
        }
        for (&self.aggregators) |*entry| if (entry.*) |row| {
            if (row.slot < current) entry.* = null;
        };
        for (&self.att_until) |*expiry| if (expiry.*) |value| {
            if (value < current) expiry.* = null;
        };
        for (&self.sync_until, update.sync_until) |*expiry, supplied| {
            if (supplied) |value| expiry.* = @max(expiry.* orelse 0, value);
            if (expiry.*) |value| if (value / p.SLOTS_PER_EPOCH < current / p.SLOTS_PER_EPOCH) {
                expiry.* = null;
            };
        }
        for (update.attesters[0..update.attester_count]) |row| {
            if (row.slot > latest or row.aggregators & ~row.subnets != 0) return error.InvalidCommitteeDuty;
            if (row.slot + 1 >= current) for (&self.att_until, 0..) |*expiry, subnet| {
                if (row.subnets & (@as(u64, 1) << @intCast(subnet)) != 0) expiry.* = @max(expiry.* orelse 0, row.slot + 1);
            };
            if (row.slot < current or row.aggregators == 0) continue;
            const entry = &self.aggregators[row.slot % duty_slots];
            if (entry.* == null or entry.*.?.slot != row.slot) entry.* = row else entry.*.?.aggregators |= row.aggregators;
        }
    }

    fn render(self: *State, chain: *const chain_mod.Config, input: *const local_state.LocalState, endpoints: ?Endpoints, max_peers: u16, signed_slot: i64, subscriptions: *[chain_mod.boundary_max]gossip.Boundary) !NetworkCore.LocalIntent {
        const current: u64 = @intCast(@max(0, signed_slot));
        const epoch = @divFloor(signed_slot, p.SLOTS_PER_EPOCH);
        self.refreshSubnets(@intCast(@max(0, epoch)));
        var local = input.*;
        local.metadata.custody_group_count = self.custody_count;
        const metadata_att = if (self.config.options.subscribe_all_subnets) std.math.maxInt(u64) else self.long_lived;
        std.mem.writeInt(u64, &local.metadata.attnets, metadata_att, .little);
        local.metadata.syncnets = 0;
        var demand: peers.Demand = .{ .attnets = metadata_att, .attestation_target = @min(6, max_peers), .sync_target = @min(6, max_peers) };
        for (self.att_until, 0..) |expiry, subnet| if (expiry) |_| {
            demand.attnets |= @as(u64, 1) << @intCast(subnet);
        };
        for (self.sync_until, 0..) |expiry, subnet| if (expiry) |_| {
            local.metadata.syncnets |= @as(u8, 1) << @intCast(subnet);
        };
        if (self.config.options.subscribe_all_subnets) local.metadata.syncnets = 15;
        demand.syncnets = @intCast(local.metadata.syncnets);
        var att = metadata_att;
        for (self.aggregators) |entry| if (entry) |row| {
            if (@as(i128, row.slot) >= signed_slot and @as(i128, row.slot) <= @as(i128, signed_slot) + self.config.options.aggregator_lead_slots) att |= row.aggregators;
        };
        const update = try chain.update(local, endpoints, current);
        if (update.local.fork.fork.gte(.fulu)) for (demand.group_targets[0..chain.custody_groups], demand.custody_group_targets[0..chain.custody_groups], 0..) |*target, *service, group| {
            target.* = if (self.sampling.isSet(group)) @min(self.config.options.target_group_peers, max_peers) else @min(4, max_peers);
            if (self.sampling.isSet(group)) service.* = @min(2, max_peers);
        };
        var count: usize = 0;
        for (chain.boundaries[0..chain.boundary_count], chain.topics[0..chain.boundary_count], 0..) |boundary, *topic, i| {
            if (@as(i128, epoch) < @as(i128, boundary.epoch) - 2) continue;
            if (i + 1 < chain.boundary_count and @as(i128, epoch) >= @as(i128, chain.boundaries[i + 1].epoch) + 2) continue;
            const set = &subscriptions[count];
            set.* = .{ .digest = boundary.digest };
            for (topic.rules, 0..) |rule, k| {
                const kind: topics.Kind = @enumFromInt(k);
                for (0..rule.count) |subnet| {
                    const subscribed = switch (kind) {
                        .beacon_attestation => att & (@as(u64, 1) << @intCast(subnet)) != 0,
                        .sync_committee => local.metadata.syncnets & (@as(u8, 1) << @intCast(subnet)) != 0,
                        .data_column_sidecar => (self.core_topics or self.custody_topics) and self.columnSubnet(chain, @intCast(subnet), rule.count),
                        .light_client_finality_update, .light_client_optimistic_update => self.core_topics and chain.serve_light_clients,
                        else => self.core_topics,
                    };
                    if (subscribed) {
                        set.mask(kind)[subnet / 8] |= @as(u8, 1) << @intCast(subnet % 8);
                        set.lengths[k] = @intCast(subnet / 8 + 1);
                    }
                }
            }
            count += 1;
        }
        return .{ .update = update, .demand = demand, .subscriptions = subscriptions[0..count] };
    }

    fn columnSubnet(self: *const State, chain: *const chain_mod.Config, subnet: u16, subnet_count: u16) bool {
        for (0..preset.NUMBER_OF_COLUMNS) |column| {
            if (column % subnet_count == subnet and self.sampling.isSet(column % chain.custody_groups)) return true;
        }
        return false;
    }

    fn refreshSubnets(self: *State, epoch: u64) void {
        const offset: u64 = @intCast(std.mem.readInt(u256, &self.node_id, .big) % self.config.subnet_subscription_epochs);
        const period = (epoch + offset) / self.config.subnet_subscription_epochs;
        if (self.subnet_period == period) return;
        var bytes: [8]u8 = undefined;
        std.mem.writeInt(u64, &bytes, period, .little);
        var seed: [32]u8 = undefined;
        std.crypto.hash.sha2.Sha256.hash(&bytes, &seed, .{});
        var permutation: [64]u8 = undefined;
        for (&permutation, 0..) |*value, i| value.* = @intCast(i);
        shuffle.unshuffleList(u8, &permutation, &seed, p.SHUFFLE_ROUND_COUNT) catch unreachable;
        const prefix = permutation[self.node_id[0] >> 2];
        self.long_lived = 0;
        for (0..self.config.subnets_per_node) |i| self.long_lived |= @as(u64, 1) << @intCast((prefix + i) % 64);
        self.subnet_period = period;
    }
};

test {
    _ = @import("application_state_test.zig");
}
