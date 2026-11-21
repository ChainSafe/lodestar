const std = @import("std");
const Allocator = std.mem.Allocator;
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const ForkTypes = @import("fork_types").ForkTypes;
const gloas_utils = @import("../utils/gloas.zig");
const findBuilderIndexByPubkey = gloas_utils.findBuilderIndexByPubkey;
const getPendingBalanceToWithdrawForBuilder = gloas_utils.getPendingBalanceToWithdrawForBuilder;
const initiateBuilderExit = gloas_utils.initiateBuilderExit;
const isActiveBuilder = gloas_utils.isActiveBuilder;
const IndexedBuilderState = @import("indexed_builder_state.zig").IndexedBuilderState;

pub fn processBuilderExitRequest(
    comptime fork: ForkSeq,
    allocator: Allocator,
    config: *const BeaconConfig,
    state: *BeaconState(fork),
    request: *const ForkTypes(fork).BuilderExitRequest.Type,
) !void {
    try processBuilderExitRequestWithIndex(fork, allocator, config, state, request, null);
}

pub fn processBuilderExitRequestWithIndex(
    comptime fork: ForkSeq,
    allocator: Allocator,
    config: *const BeaconConfig,
    state: *BeaconState(fork),
    request: *const ForkTypes(fork).BuilderExitRequest.Type,
    indexed: ?*IndexedBuilderState(fork),
) !void {
    const maybe_builder_index = if (indexed) |cache| cache.find(&request.pubkey) else try findBuilderIndexByPubkey(fork, allocator, state, &request.pubkey);
    const builder_index = maybe_builder_index orelse return;

    var builders = try state.inner.get("builders");
    var builder: ForkTypes(fork).Builder.Type = undefined;
    try builders.getValue(allocator, builder_index, &builder);

    if (!isActiveBuilder(fork, &builder, try state.finalizedEpoch())) {
        return;
    }
    if (!std.mem.eql(u8, &builder.execution_address, &request.source_address)) {
        return;
    }
    if (try getPendingBalanceToWithdrawForBuilder(fork, state, builder_index) != 0) {
        return;
    }

    try initiateBuilderExit(fork, config, state, builder_index);
}
