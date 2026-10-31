const std = @import("std");
const ct = @import("consensus_types");
const BeaconConfig = @import("config").BeaconConfig;
const DOMAIN_INCLUSION_LIST_COMMITTEE = @import("constants").DOMAIN_INCLUSION_LIST_COMMITTEE;
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;

pub fn getInclusionListSigningRoot(
    allocator: std.mem.Allocator,
    config: *const BeaconConfig,
    state_slot: u64,
    inclusion_list: *const ct.heze.InclusionList.Type,
) ![32]u8 {
    const domain = try config.getDomain(computeEpochAtSlot(state_slot), DOMAIN_INCLUSION_LIST_COMMITTEE, inclusion_list.slot);
    var object_root: [32]u8 = undefined;
    try ct.heze.InclusionList.hashTreeRoot(allocator, inclusion_list, &object_root);
    var out: [32]u8 = undefined;
    try computeSigningRoot(ct.primitive.Root, &object_root, domain, &out);
    return out;
}

test "Heze inclusion list signing root follows the message domain at the fork boundary" {
    const preset = @import("preset").preset;
    const computeDomain = @import("../utils/domain.zig").computeDomain;
    const chain = @import("config").minimal.chain_config.merge(.{ .GLOAS_FORK_EPOCH = 2, .HEZE_FORK_EPOCH = 3 });
    const genesis_root: [32]u8 = @splat(42);
    const config = BeaconConfig.init(chain, genesis_root);
    const fork_slot = 3 * preset.SLOTS_PER_EPOCH;
    var inclusion_list = ct.heze.InclusionList.default_value;
    defer ct.heze.InclusionList.deinit(std.testing.allocator, &inclusion_list);
    inclusion_list.validator_index = 17;
    inclusion_list.dependent_root = @splat(7);
    try inclusion_list.transactions.append(std.testing.allocator, .empty);
    try inclusion_list.transactions.items[0].appendSlice(std.testing.allocator, &.{ 1, 2, 3 });

    for ([_]u64{ fork_slot - 1, fork_slot, fork_slot + 1 }) |slot| {
        inclusion_list.slot = slot;
        var signing_data: ct.phase0.SigningData.Type = undefined;
        try ct.heze.InclusionList.hashTreeRoot(std.testing.allocator, &inclusion_list, &signing_data.object_root);
        try computeDomain(
            DOMAIN_INCLUSION_LIST_COMMITTEE,
            if (slot < fork_slot) chain.GLOAS_FORK_VERSION else chain.HEZE_FORK_VERSION,
            genesis_root,
            &signing_data.domain,
        );
        var expected: [32]u8 = undefined;
        try ct.phase0.SigningData.hashTreeRoot(&signing_data, &expected);
        const actual = try getInclusionListSigningRoot(std.testing.allocator, &config, fork_slot, &inclusion_list);
        try std.testing.expectEqualSlices(u8, &expected, &actual);
    }
}
