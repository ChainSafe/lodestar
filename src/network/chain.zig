const std = @import("std");
const config = @import("config");
const ct = @import("consensus_types");
const preset = @import("preset");
const constants = @import("constants");
const topics = @import("gossipsub/topic_policy.zig");
const policy = @import("reqresp/request_policy.zig");
const advertisement = @import("advertisement.zig");
const values = @import("local_state.zig");
const capabilities = @import("capabilities.zig");
const ForkEntry = @import("types.zig").ForkEntry;
const gossipsub_constants = @import("gossipsub/constants.zig");
const meshsub = @import("gossipsub/protocol.zig");

pub const boundary_max = topics.boundary_max;
pub const Boundary = struct { epoch: u64, fork: config.ForkSeq, digest: [4]u8, version: [4]u8 };

/// Startup-derived network data. No slice or pointer borrows the source BeaconConfig.
pub const Config = struct {
    boundaries: [boundary_max]Boundary = undefined,
    boundary_count: u8 = 0,
    unsupported_fork: ?struct { epoch: u64, version: [4]u8, digest: [4]u8 } = null,
    forks: [boundary_max]ForkEntry = undefined,
    topics: [boundary_max]topics.Boundary = undefined,
    policy: policy.Policy,
    phase0_digest: ?[4]u8 = null,
    fulu_scheduled: bool,
    custody_groups: u16,
    sampling_groups: u16,
    custody_requirement: u16,
    serve_light_clients: bool,

    pub fn init(cfg: *const config.BeaconConfig, serve_light_clients: bool) !Config {
        const chain = &cfg.chain;
        if (chain.PRESET_BASE != preset.active_preset or chain.BLOB_SCHEDULE.len > boundary_max - config.ForkSeq.count or
            chain.MAX_PAYLOAD_SIZE == 0 or chain.MAX_PAYLOAD_SIZE > gossipsub_constants.MAX_PAYLOAD_SIZE or
            chain.NUMBER_OF_CUSTODY_GROUPS == 0 or chain.NUMBER_OF_CUSTODY_GROUPS > preset.NUMBER_OF_CUSTODY_GROUPS or
            chain.CUSTODY_REQUIREMENT == 0 or chain.CUSTODY_REQUIREMENT > chain.NUMBER_OF_CUSTODY_GROUPS or
            chain.SAMPLES_PER_SLOT == 0 or chain.SAMPLES_PER_SLOT > chain.NUMBER_OF_CUSTODY_GROUPS)
            return error.InvalidNetworkChain;
        var epochs: [boundary_max]u64 = undefined;
        var count: usize = 0;
        for (cfg.forks_ascending_epoch_order, 0..) |fork, i| {
            if (i > 0 and fork.epoch < cfg.forks_ascending_epoch_order[i - 1].epoch) return error.InvalidNetworkChain;
            if (fork.epoch == constants.FAR_FUTURE_EPOCH) continue;
            if (fork.epoch >= chain.HEZE_FORK_EPOCH) continue;
            epochs[count] = fork.epoch;
            count += 1;
        }
        for (chain.BLOB_SCHEDULE, 0..) |entry, i| {
            if (entry.MAX_BLOBS_PER_BLOCK == 0 or entry.MAX_BLOBS_PER_BLOCK > preset.preset.MAX_BLOB_COMMITMENTS_PER_BLOCK or
                (i > 0 and entry.EPOCH <= chain.BLOB_SCHEDULE[i - 1].EPOCH)) return error.InvalidNetworkChain;
            if (entry.EPOCH < chain.FULU_FORK_EPOCH or entry.EPOCH >= chain.HEZE_FORK_EPOCH) continue;
            epochs[count] = entry.EPOCH;
            count += 1;
        }
        std.sort.insertion(u64, epochs[0..count], {}, std.sort.asc(u64));
        var blob_storage: [policy.schedule_max]policy.BlobLimit = undefined;
        var request = try policy.Config.fromBeaconConfig(cfg, &blob_storage);
        request.host_integer_max = 9007199254740991;
        var result: Config = .{
            .policy = try policy.Policy.init(&request),
            .fulu_scheduled = chain.FULU_FORK_EPOCH != constants.FAR_FUTURE_EPOCH,
            .custody_groups = @intCast(chain.NUMBER_OF_CUSTODY_GROUPS),
            .sampling_groups = @intCast(chain.SAMPLES_PER_SLOT),
            .custody_requirement = @intCast(chain.CUSTODY_REQUIREMENT),
            .serve_light_clients = serve_light_clients,
        };
        if (chain.HEZE_FORK_EPOCH != constants.FAR_FUTURE_EPOCH) result.unsupported_fork = .{
            .epoch = chain.HEZE_FORK_EPOCH,
            .version = chain.HEZE_FORK_VERSION,
            .digest = config.fork_digest.computeForkDigestForVersion(cfg, chain.HEZE_FORK_EPOCH, chain.HEZE_FORK_VERSION),
        };
        for (epochs[0..count]) |epoch| {
            if (result.boundary_count > 0 and result.boundaries[result.boundary_count - 1].epoch == epoch) continue;
            _ = std.math.mul(u64, epoch, preset.preset.SLOTS_PER_EPOCH) catch return error.InvalidNetworkChain;
            const fork = cfg.forkInfoAtEpoch(epoch);
            if (epoch >= chain.HEZE_FORK_EPOCH) continue;
            const digest = config.fork_digest.computeForkDigest(cfg, epoch);
            result.boundaries[result.boundary_count] = .{ .epoch = epoch, .fork = fork.fork_seq, .version = fork.version, .digest = digest };
            for (result.forks[0..result.boundary_count]) |prior| {
                if (std.mem.eql(u8, &prior.digest, &digest)) return error.InvalidNetworkChain;
            }
            result.forks[result.boundary_count] = .{ .fork = fork.fork_seq, .digest = digest };
            result.topics[result.boundary_count] = try topicBoundary(cfg, fork.fork_seq, digest, epoch);
            result.topics[result.boundary_count].fork = fork.fork_seq;
            result.topics[result.boundary_count].epoch = epoch;
            result.boundary_count += 1;
            if (fork.fork_seq == .phase0) result.phase0_digest = digest;
        }
        if (result.boundary_count == 0) return error.UnsupportedNetworkFork;
        _ = try topics.validate(result.topics[0..result.boundary_count]);
        try result.validateScheduledTopicDemand();
        return result;
    }

    // The application adds namespaces two epochs early and removes them two epochs late.
    // Resident storage covers the complete namespace, including outgoing and retained rows.
    // The live subscription limit applies to the committed application schedule.
    fn validateScheduledTopicDemand(self: *const Config) error{UnsupportedTopicOverlap}!void {
        const lookahead: u64 = 2;
        var counts: [boundary_max]usize = @splat(0);
        for (self.topics[0..self.boundary_count], counts[0..self.boundary_count]) |*boundary, *count| {
            for (boundary.rules, 0..) |topic_rule, k| {
                const kind: topics.Kind = @enumFromInt(k);
                if (!self.serve_light_clients and (kind == .light_client_finality_update or kind == .light_client_optimistic_update)) continue;
                count.* += topic_rule.count;
            }
        }
        for (self.boundaries[0..self.boundary_count]) |incoming| {
            const epoch = incoming.epoch -| lookahead;
            var demand: usize = 0;
            for (self.boundaries[0..self.boundary_count], 0..) |boundary, i| {
                if (epoch < boundary.epoch -| lookahead) continue;
                if (i + 1 < self.boundary_count and epoch >= self.boundaries[i + 1].epoch +| lookahead) continue;
                demand += counts[i];
            }
            if (demand > gossipsub_constants.topics_cap) return error.UnsupportedTopicOverlap;
        }
    }

    pub fn requestPolicy(self: *const Config) policy.Config {
        var result = self.policy.config;
        result.blob_schedule = self.policy.points[0..self.policy.point_count];
        return result;
    }

    pub fn update(self: *const Config, local: values.LocalState, endpoints: ?advertisement.Endpoints, slot: u64) !values.LocalUpdate {
        const epoch = slot / preset.preset.SLOTS_PER_EPOCH;
        if (self.unsupported_fork) |fork| if (epoch >= fork.epoch) return error.UnsupportedNetworkFork;
        var index: usize = 0;
        for (self.boundaries[0..self.boundary_count], 0..) |boundary, i| {
            if (boundary.epoch > epoch) break;
            index = i;
        }
        const current = self.boundaries[index];
        var result: values.LocalUpdate = .{
            .local = local,
            .endpoints = endpoints,
            .schedule = .{ .fulu_scheduled = self.fulu_scheduled, .next_version = current.version },
            .capabilities = capabilities.withIdentify(try capabilities.forFork(current.fork, self.serve_light_clients, &meshsub.versions)),
        };
        result.local.fork = .{
            .fork = current.fork,
            .digest = current.digest,
            .custody_groups = self.custody_groups,
            .minimum_sampling_groups = if (current.fork.gte(.fulu)) self.sampling_groups else 0,
            .custody_requirement = if (current.fork.gte(.fulu)) self.custody_requirement else 0,
        };
        result.local.status.fork_digest = current.digest;
        if (index + 1 < self.boundary_count) {
            const next = self.boundaries[index + 1];
            result.schedule.next_version = next.version;
            result.schedule.next_epoch = next.epoch;
            result.schedule.next_digest = next.digest;
        } else if (self.unsupported_fork) |next| {
            result.schedule.next_version = next.version;
            result.schedule.next_epoch = next.epoch;
            result.schedule.next_digest = next.digest;
        }
        try values.copyServingLocal(&result.local, &result.local, result.capabilities.receive);
        return result;
    }
};

fn rule(comptime T: type, count: u64, payload_max: u64) !topics.Rule {
    if (count == 0 or count > std.math.maxInt(u16)) return error.InvalidNetworkChain;
    const minimum = if (@hasDecl(T, "fixed_size")) T.fixed_size else T.min_size;
    const maximum = @min(if (@hasDecl(T, "fixed_size")) T.fixed_size else T.max_size, payload_max);
    if (minimum > maximum) return error.InvalidNetworkChain;
    return .{ .count = @intCast(count), .ssz_min = minimum, .ssz_max = @intCast(maximum) };
}

fn topicBoundary(cfg: *const config.BeaconConfig, fork: config.ForkSeq, digest: [4]u8, epoch: u64) !topics.Boundary {
    var result: topics.Boundary = .{ .digest = digest };
    const chain = &cfg.chain;
    const max = chain.MAX_PAYLOAD_SIZE;
    const r = &result.rules;
    r[@intFromEnum(topics.Kind.proposer_slashing)] = try rule(ct.phase0.ProposerSlashing, 1, max);
    r[@intFromEnum(topics.Kind.voluntary_exit)] = try rule(ct.phase0.SignedVoluntaryExit, 1, max);
    switch (fork) {
        inline else => |selected| {
            const types = @field(ct, @tagName(selected));
            r[@intFromEnum(topics.Kind.beacon_block)] = try rule(types.SignedBeaconBlock, 1, max);
            r[@intFromEnum(topics.Kind.beacon_aggregate_and_proof)] = try rule(types.SignedAggregateAndProof, 1, if (comptime selected.gte(.gloas)) @min(max, preset.preset.MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE) else max);
            r[@intFromEnum(topics.Kind.beacon_attestation)] = try rule(if (comptime selected.gte(.electra)) types.SingleAttestation else types.Attestation, constants.ATTESTATION_SUBNET_COUNT, max);
            r[@intFromEnum(topics.Kind.attester_slashing)] = try rule(types.AttesterSlashing, 1, if (comptime selected.gte(.gloas)) @min(max, preset.preset.MAX_ATTESTER_SLASHING_SIZE) else max);
            if (comptime selected.gte(.altair)) {
                r[@intFromEnum(topics.Kind.sync_committee_contribution_and_proof)] = try rule(ct.altair.SignedContributionAndProof, 1, max);
                r[@intFromEnum(topics.Kind.sync_committee)] = try rule(ct.altair.SyncCommitteeMessage, constants.SYNC_COMMITTEE_SUBNET_COUNT, max);
                r[@intFromEnum(topics.Kind.light_client_finality_update)] = try rule(types.LightClientFinalityUpdate, 1, max);
                r[@intFromEnum(topics.Kind.light_client_optimistic_update)] = try rule(types.LightClientOptimisticUpdate, 1, max);
            }
            if (comptime selected.gte(.capella)) r[@intFromEnum(topics.Kind.bls_to_execution_change)] = try rule(ct.capella.SignedBLSToExecutionChange, 1, max);
            if (comptime selected.gte(.gloas)) {
                r[@intFromEnum(topics.Kind.execution_payload)] = try rule(types.SignedExecutionPayloadEnvelope, 1, max);
                r[@intFromEnum(topics.Kind.payload_attestation_message)] = try rule(types.PayloadAttestationMessage, 1, max);
                r[@intFromEnum(topics.Kind.execution_payload_bid)] = try rule(types.SignedExecutionPayloadBid, 1, @min(max, preset.preset.MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE));
                r[@intFromEnum(topics.Kind.proposer_preferences)] = try rule(types.SignedProposerPreferences, 1, max);
                const column_max = @import("reqresp/response_bounds.zig").gloasColumnMax(chain);
                r[@intFromEnum(topics.Kind.data_column_sidecar)] = try rule(types.DataColumnSidecar, chain.DATA_COLUMN_SIDECAR_SUBNET_COUNT, @min(max, column_max));
            } else if (comptime selected.gte(.fulu)) {
                const per_blob = ct.fulu.Cell.fixed_size + ct.primitive.KZGCommitment.fixed_size + ct.primitive.KZGProof.fixed_size;
                const column_max = types.DataColumnSidecar.min_size +| cfg.getMaxBlobsPerBlock(epoch) *| per_blob;
                r[@intFromEnum(topics.Kind.data_column_sidecar)] = try rule(types.DataColumnSidecar, chain.DATA_COLUMN_SIDECAR_SUBNET_COUNT, @min(max, column_max));
            } else if (comptime selected.gte(.deneb)) {
                r[@intFromEnum(topics.Kind.blob_sidecar)] = try rule(ct.deneb.BlobSidecar, if (selected.gte(.electra)) chain.BLOB_SIDECAR_SUBNET_COUNT_ELECTRA else chain.BLOB_SIDECAR_SUBNET_COUNT, max);
            }
        },
    }
    return result;
}

test {
    _ = @import("chain_test.zig");
}
