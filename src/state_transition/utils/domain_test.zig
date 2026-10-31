//! Tests for `domain.zig`.

const std = @import("std");
const types = @import("consensus_types");
const Domain = types.primitive.Domain.Type;
const Root = types.primitive.Root.Type;
const Fork = types.phase0.Fork.Type;
const testing = std.testing;
const constants = @import("constants");
const DOMAIN_BEACON_PROPOSER = constants.DOMAIN_BEACON_PROPOSER;
const DOMAIN_BEACON_ATTESTER = constants.DOMAIN_BEACON_ATTESTER;
const DOMAIN_VOLUNTARY_EXIT = constants.DOMAIN_VOLUNTARY_EXIT;
const domain_mod = @import("domain.zig");
const computeDomain = domain_mod.computeDomain;
const computeForkDataRoot = domain_mod.computeForkDataRoot;
const forkVersion = domain_mod.forkVersion;

test "computeDomain - domain type is first 4 bytes" {
    const fork_version = [4]u8{ 0x01, 0x00, 0x00, 0x00 };
    const genesis_root = [_]u8{0} ** 32;
    var domain: Domain = undefined;

    try computeDomain(DOMAIN_VOLUNTARY_EXIT, fork_version, genesis_root, &domain);

    try testing.expectEqualSlices(u8, &DOMAIN_VOLUNTARY_EXIT, domain[0..4]);
}

test "computeDomain - different domain types produce different domains" {
    const fork_version = [4]u8{ 0x01, 0x00, 0x00, 0x00 };
    const genesis_root = [_]u8{0xAA} ** 32;

    var domain_a: Domain = undefined;
    var domain_b: Domain = undefined;

    try computeDomain(DOMAIN_BEACON_PROPOSER, fork_version, genesis_root, &domain_a);
    try computeDomain(DOMAIN_BEACON_ATTESTER, fork_version, genesis_root, &domain_b);

    try testing.expect(!std.mem.eql(u8, &domain_a, &domain_b));
}

test "computeDomain - different fork versions produce different domains" {
    const genesis_root = [_]u8{0xBB} ** 32;

    var domain_a: Domain = undefined;
    var domain_b: Domain = undefined;
    const version_a = [4]u8{ 0x01, 0x00, 0x00, 0x00 };
    const version_b = [4]u8{ 0x02, 0x00, 0x00, 0x00 };

    try computeDomain(DOMAIN_BEACON_PROPOSER, version_a, genesis_root, &domain_a);
    try computeDomain(DOMAIN_BEACON_PROPOSER, version_b, genesis_root, &domain_b);

    // First 4 bytes (domain type) are the same
    try testing.expectEqualSlices(u8, domain_a[0..4], domain_b[0..4]);
    // But the fork data root portion differs
    try testing.expect(!std.mem.eql(u8, domain_a[4..32], domain_b[4..32]));
}

test "forkVersion - given epoch returns correct version" {
    const fork: Fork = .{
        .previous_version = [4]u8{ 0x01, 0x00, 0x00, 0x00 },
        .current_version = [4]u8{ 0x02, 0x00, 0x00, 0x00 },
        .epoch = 100,
    };
    try testing.expectEqualSlices(u8, &fork.previous_version, &forkVersion(fork, 99));
    try testing.expectEqualSlices(u8, &fork.current_version, &forkVersion(fork, 100));
    try testing.expectEqualSlices(u8, &fork.current_version, &forkVersion(fork, 200));
}

test "computeForkDataRoot - different inputs produce different roots" {
    const genesis_root = [_]u8{0xDD} ** 32;
    var root_a: Root = undefined;
    var root_b: Root = undefined;

    try computeForkDataRoot([4]u8{ 0x01, 0x00, 0x00, 0x00 }, genesis_root, &root_a);
    try computeForkDataRoot([4]u8{ 0x02, 0x00, 0x00, 0x00 }, genesis_root, &root_b);

    try testing.expect(!std.mem.eql(u8, &root_a, &root_b));
}
