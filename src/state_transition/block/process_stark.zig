const std = @import("std");
const Allocator = std.mem.Allocator;
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const ForkTypes = @import("fork_types").ForkTypes;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const appendAttestationClaims = @import("../signature_sets/indexed_attestation.zig").appendAttestationClaims;
const pq = @import("../utils/pq.zig");

/// Checks that `proof` proves a signature of every attester of `attestations`.
pub fn processStark(
    comptime fork: ForkSeq,
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    attestations: []const ForkTypes(fork).Attestation.Type,
    proof: []const u8,
) !void {
    var claims: std.ArrayList(pq.Claim) = .empty;
    defer claims.deinit(allocator);
    for (attestations) |*attestation| {
        var attesting_indices = try epoch_cache.getAttestingIndices(fork, allocator, attestation);
        defer attesting_indices.deinit(allocator);
        try appendAttestationClaims(allocator, io, config, epoch_cache, &attestation.data, attesting_indices.items, &claims);
    }
    if (!try pq.verifyAttestationProof(claims.items, proof)) return error.InvalidAttestationProof;
}
