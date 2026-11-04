const std = @import("std");
const Allocator = std.mem.Allocator;
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const ForkTypes = @import("fork_types").ForkTypes;
const types = @import("consensus_types");
const c = @import("constants");
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const gloas_utils = @import("../utils/gloas.zig");
const addBuilderToRegistry = gloas_utils.addBuilderToRegistry;
const findBuilderIndexByPubkey = gloas_utils.findBuilderIndexByPubkey;
const isValidBuilderDepositSignature = gloas_utils.isValidBuilderDepositSignature;
const IndexedBuilderState = @import("indexed_builder_state.zig").IndexedBuilderState;

pub fn processBuilderDepositRequest(
    comptime fork: ForkSeq,
    allocator: Allocator,
    config: *const BeaconConfig,
    state: *BeaconState(fork),
    request: *const ForkTypes(fork).BuilderDepositRequest.Type,
) !void {
    try processBuilderDepositRequestWithIndex(fork, allocator, config, state, request, null);
}

pub fn processBuilderDepositRequestWithIndex(
    comptime fork: ForkSeq,
    allocator: Allocator,
    config: *const BeaconConfig,
    state: *BeaconState(fork),
    request: *const ForkTypes(fork).BuilderDepositRequest.Type,
    indexed: ?*IndexedBuilderState(fork),
) !void {
    if (!gloas_utils.isBuilderWithdrawalCredential(&request.withdrawal_credentials)) return;

    const builder_index = if (indexed) |cache| cache.find(&request.pubkey) else try findBuilderIndexByPubkey(fork, allocator, state, &request.pubkey);
    if (builder_index) |idx| {
        var builders = try state.inner.get("builders");
        var builder: ForkTypes(fork).Builder.Type = undefined;
        try builders.getValue(allocator, idx, &builder);

        if (builder.withdrawable_epoch != c.FAR_FUTURE_EPOCH and builder.balance == 0) {
            builder.withdrawable_epoch = computeEpochAtSlot(try state.slot()) + config.chain.MIN_BUILDER_WITHDRAWABILITY_DELAY;
        }

        builder.balance = try std.math.add(u64, builder.balance, request.amount);

        try builders.setValue(idx, &builder);
        return;
    }

    if (!isValidBuilderDepositSignature(
        config,
        &request.pubkey,
        &request.withdrawal_credentials,
        request.amount,
        request.signature,
    )) {
        return;
    }

    var execution_address: types.primitive.ExecutionAddress.Type = undefined;
    @memcpy(&execution_address, request.withdrawal_credentials[12..32]);

    if (indexed) |cache| return cache.addBuilder(&request.pubkey, &execution_address, request.amount);
    try addBuilderToRegistry(
        fork,
        allocator,
        state,
        &request.pubkey,
        c.PAYLOAD_BUILDER_VERSION,
        &execution_address,
        request.amount,
        try state.slot(),
    );
}
