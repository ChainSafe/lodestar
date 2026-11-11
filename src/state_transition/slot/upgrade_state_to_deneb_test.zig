//! Tests for `upgrade_state_to_deneb.zig`.

const std = @import("std");
const config = @import("config");
const ct = @import("consensus_types");
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const active_preset = @import("preset").active_preset;
const Node = @import("persistent_merkle_tree").Node;
const getConfig = @import("../test_utils/generate_state.zig").getConfig;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const PubkeyCache = @import("../cache/pubkey_cache.zig").PubkeyCache;
const upgradeStateToCapella = @import("upgrade_state_to_capella.zig").upgradeStateToCapella;
const upgradeStateToDeneb = @import("upgrade_state_to_deneb.zig").upgradeStateToDeneb;

test "memory_safety: upgradeStateToCapella and upgradeStateToDeneb should release temporary payload headers" {
    const allocator = std.testing.allocator;
    const chain_config = if (active_preset == .mainnet)
        config.mainnet.chain_config
    else
        config.minimal.chain_config;

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 345_000 });
    defer pool.deinit();

    var bellatrix_value = ct.bellatrix.BeaconState.default_value;
    defer ct.bellatrix.BeaconState.deinit(allocator, &bellatrix_value);
    bellatrix_value.fork = .{
        .previous_version = chain_config.ALTAIR_FORK_VERSION,
        .current_version = chain_config.BELLATRIX_FORK_VERSION,
        .epoch = 0,
    };
    try bellatrix_value.latest_execution_payload_header.extra_data.append(allocator, 0xaa);

    var state = try AnyBeaconState.fromValue(allocator, &pool, .bellatrix, &bellatrix_value);
    defer state.deinit();

    var pubkey_cache = PubkeyCache.init(allocator, std.testing.io);
    defer pubkey_cache.deinit();

    const beacon_config = config.BeaconConfig.init(
        getConfig(chain_config, .bellatrix, 0),
        (try state.genesisValidatorsRoot()).*,
    );
    const epoch_cache = try EpochCache.createFromState(
        allocator,
        std.testing.io,
        &state,
        .{
            .config = &beacon_config,
            .pubkey_cache = &pubkey_cache,
        },
        .{
            .skip_sync_committee_cache = true,
            .skip_sync_pubkeys = true,
        },
    );
    defer epoch_cache.deinit();

    // std.testing.allocator makes the test fail without an explicit expect if either upgrade
    // leaks its temporary payload header.
    const capella_state = try upgradeStateToCapella(
        allocator,
        &beacon_config,
        epoch_cache,
        state.castToFork(.bellatrix),
    );
    state = .{ .capella = capella_state.inner };

    const deneb_state = try upgradeStateToDeneb(
        allocator,
        &beacon_config,
        epoch_cache,
        state.castToFork(.capella),
    );
    state = .{ .deneb = deneb_state.inner };
}
