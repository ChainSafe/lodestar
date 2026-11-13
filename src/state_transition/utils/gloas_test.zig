const std = @import("std");
const ct = @import("consensus_types");
const c = @import("constants");
const preset = @import("preset").preset;
const config_module = @import("config");
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const Node = @import("persistent_merkle_tree").Node;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const PubkeyCache = @import("../cache/pubkey_cache.zig").PubkeyCache;
const getPayloadTimelinessCommittee = @import("gloas.zig").getPayloadTimelinessCommittee;
const processPayloadAttestation = @import("../block/process_payload_attestation.zig").processPayloadAttestation;

test "Gloas PTC lookup enforces the fork boundary and previous current next epoch window" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 350_000 });
    defer pool.deinit();
    var any_state = try AnyBeaconState.fromValue(allocator, &pool, .gloas, &ct.gloas.BeaconState.default_value);
    defer any_state.deinit();
    const state = any_state.castToFork(.gloas);
    const active_config = if (@import("preset").active_preset == .mainnet) config_module.mainnet.chain_config else config_module.minimal.chain_config;
    var config = config_module.BeaconConfig.init(active_config, c.ZERO_HASH);
    config.chain.GLOAS_FORK_EPOCH = 2;
    try state.setSlot(3 * preset.SLOTS_PER_EPOCH);
    var window = try state.inner.get("ptc_window");
    for (0..2 + preset.MIN_SEED_LOOKAHEAD) |epoch_offset| {
        const committee: ct.gloas.PayloadTimelinessCommittee.Type = @splat(epoch_offset + 1);
        try window.setValue(epoch_offset * preset.SLOTS_PER_EPOCH, &committee);
        var result: ct.gloas.PayloadTimelinessCommittee.Type = undefined;
        try getPayloadTimelinessCommittee(.gloas, &config, state, (epoch_offset + 2) * preset.SLOTS_PER_EPOCH, &result);
        try std.testing.expectEqualSlices(u64, &committee, &result);
    }
    var result: ct.gloas.PayloadTimelinessCommittee.Type = undefined;
    try std.testing.expectError(error.PayloadTimelinessCommitteeBeforeGloas, getPayloadTimelinessCommittee(.gloas, &config, state, preset.SLOTS_PER_EPOCH, &result));
    try std.testing.expectError(error.PayloadTimelinessCommitteeOutOfRange, getPayloadTimelinessCommittee(.gloas, &config, state, (4 + preset.MIN_SEED_LOOKAHEAD) * preset.SLOTS_PER_EPOCH, &result));
    try state.setSlot(2 * preset.SLOTS_PER_EPOCH);
    var pubkeys = PubkeyCache.init(allocator, std.testing.io);
    defer pubkeys.deinit();
    const epoch_cache = try EpochCache.createFromState(allocator, std.testing.io, &any_state, .{ .config = &config, .pubkey_cache = &pubkeys }, .{ .skip_sync_committee_cache = true, .skip_sync_pubkeys = true });
    defer epoch_cache.deinit();
    var attestation = ct.gloas.PayloadAttestation.default_value;
    attestation.data.slot = 2 * preset.SLOTS_PER_EPOCH - 1;
    try std.testing.expectError(error.PayloadTimelinessCommitteeBeforeGloas, processPayloadAttestation(.gloas, std.testing.io, &config, epoch_cache, state, &attestation, false));
}
