//! Consensus types that reach the node as untrusted bytes over gossip and reqresp, one selector
//! per distinct SSZ type. The harness and the corpus extractor share this table so a selector
//! byte means the same type in both. Forks that re-export an earlier fork's type share its
//! selector; `sources` lists every fork directory that holds spec vectors for a selector.
const std = @import("std");
const ct = @import("consensus_types");

pub const Entry = struct { fork: []const u8, name: []const u8, T: type };
pub const Source = struct { fork: []const u8, name: []const u8, selector: u8 };

const all = [_][]const u8{ "phase0", "altair", "bellatrix", "capella", "deneb", "electra", "fulu", "gloas" };
const since_altair = all[1..];
const since_bellatrix = all[2..];
const since_capella = all[3..];
const since_deneb = all[4..];
const since_fulu = all[6..];
const gloas = all[7..];

const listed = [_]struct { name: []const u8, forks: []const []const u8 }{
    .{ .name = "SignedBeaconBlock", .forks = &all },
    .{ .name = "SignedBlindedBeaconBlock", .forks = since_bellatrix[0 .. since_bellatrix.len - 1] },
    .{ .name = "BlobSidecar", .forks = since_deneb },
    .{ .name = "DataColumnSidecar", .forks = since_fulu },
    .{ .name = "Attestation", .forks = &all },
    .{ .name = "SignedAggregateAndProof", .forks = &all },
    .{ .name = "AttesterSlashing", .forks = &all },
    .{ .name = "ProposerSlashing", .forks = &all },
    .{ .name = "SignedVoluntaryExit", .forks = &all },
    .{ .name = "SyncCommitteeMessage", .forks = since_altair },
    .{ .name = "SignedContributionAndProof", .forks = since_altair },
    .{ .name = "SignedBLSToExecutionChange", .forks = since_capella },
    .{ .name = "LightClientBootstrap", .forks = since_altair },
    .{ .name = "LightClientUpdate", .forks = since_altair },
    .{ .name = "LightClientFinalityUpdate", .forks = since_altair },
    .{ .name = "LightClientOptimisticUpdate", .forks = since_altair },
    .{ .name = "SignedExecutionPayloadEnvelope", .forks = gloas },
    .{ .name = "SignedExecutionPayloadBid", .forks = gloas },
    .{ .name = "PayloadAttestationMessage", .forks = gloas },
};

fn resolve(comptime fork: []const u8, comptime name: []const u8) type {
    return @field(@field(ct, fork), name);
}

pub const entries: []const Entry = blk: {
    @setEvalBranchQuota(200_000);
    var out: []const Entry = &.{};
    for (listed) |item| for (item.forks) |fork| {
        const T = resolve(fork, item.name);
        var seen = false;
        for (out) |entry| seen = seen or entry.T == T;
        if (!seen) out = out ++ &[_]Entry{.{ .fork = fork, .name = item.name, .T = T }};
    };
    std.debug.assert(out.len > 0 and out.len <= 256);
    break :blk out;
};

pub const sources: []const Source = blk: {
    @setEvalBranchQuota(200_000);
    var out: []const Source = &.{};
    for (listed) |item| for (item.forks) |fork| {
        const T = resolve(fork, item.name);
        for (entries, 0..) |entry, index| {
            if (entry.T == T) out = out ++ &[_]Source{.{ .fork = fork, .name = item.name, .selector = index }};
        }
    };
    break :blk out;
};

test "every listed wire type resolves to one selector" {
    try std.testing.expect(sources.len >= entries.len);
    for (sources) |source| try std.testing.expect(source.selector < entries.len);
}
