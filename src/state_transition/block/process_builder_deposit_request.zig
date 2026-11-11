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
const pq = @import("../utils/pq.zig");
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

    // From PQ a legacy request, which names a BLS public key, is for the key derived from it.
    const pubkey = if (comptime fork == .pq) pq.requestPubkey(&pq.computeDepositPubkey(&request.pubkey)) else request.pubkey;

    const builder_index = if (indexed) |cache| cache.find(&pubkey) else try findBuilderIndexByPubkey(fork, allocator, state, &pubkey);
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

    // From PQ a builder deposit carries no signature.
    if (comptime fork != .pq) {
        if (!isValidBuilderDepositSignature(
            config,
            &request.pubkey,
            &request.withdrawal_credentials,
            request.amount,
            request.signature,
        )) {
            return;
        }
    }

    var execution_address: types.primitive.ExecutionAddress.Type = undefined;
    @memcpy(&execution_address, request.withdrawal_credentials[12..32]);

    if (indexed) |cache| {
        try cache.addBuilder(&pubkey, &execution_address, request.amount);
    } else {
        try addBuilderToRegistry(
            fork,
            allocator,
            state,
            &pubkey,
            c.PAYLOAD_BUILDER_VERSION,
            &execution_address,
            request.amount,
            try state.slot(),
        );
    }

    // No signature verifies against a legacy deposit's key: its builder exits at once.
    if (comptime fork == .pq) {
        if (!pq.isLegacyPubkey(&request.pubkey)) return;
        const new_index = if (indexed) |cache| cache.find(&pubkey) else try findBuilderIndexByPubkey(fork, allocator, state, &pubkey);
        try gloas_utils.initiateBuilderExit(fork, config, state, new_index orelse return error.BuilderNotFound);
    }
}
