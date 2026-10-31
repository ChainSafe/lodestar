const std = @import("std");
const Allocator = std.mem.Allocator;
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const ForkTypes = @import("fork_types").ForkTypes;
const BeaconBlock = @import("fork_types").BeaconBlock;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const preset = @import("preset").preset;
const processDepositRequest = @import("./process_deposit_request.zig").processDepositRequest;
const processWithdrawalRequest = @import("./process_withdrawal_request.zig").processWithdrawalRequest;
const processConsolidationRequest = @import("./process_consolidation_request.zig").processConsolidationRequest;
const processBuilderDepositRequest = @import("./process_builder_deposit_request.zig").processBuilderDepositRequestWithIndex;
const processBuilderExitRequest = @import("./process_builder_exit_request.zig").processBuilderExitRequestWithIndex;
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const IndexedBuilderState = @import("indexed_builder_state.zig").IndexedBuilderState;

pub fn processParentExecutionPayload(
    comptime fork: ForkSeq,
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    block: *const BeaconBlock(.full, fork),
) !void {
    const bid = &block.body().inner.signed_execution_payload_bid.message;
    var parent_bid = ForkTypes(fork).ExecutionPayloadBid.default_value;
    defer ForkTypes(fork).ExecutionPayloadBid.deinit(allocator, &parent_bid);
    try state.inner.getValue(allocator, "latest_execution_payload_bid", &parent_bid);

    const requests = &block.body().inner.parent_execution_requests;
    try validateExecutionRequests(fork, requests);
    const is_parent_block_full = std.mem.eql(u8, &bid.parent_block_hash, &parent_bid.block_hash);
    if (!is_parent_block_full) {
        if (requests.deposits.items.len != 0 or
            requests.withdrawals.items.len != 0 or
            requests.consolidations.items.len != 0 or
            requests.builder_deposits.items.len != 0 or
            requests.builder_exits.items.len != 0)
        {
            return error.ParentExecutionRequestsNotEmpty;
        }
        return;
    }

    var requests_root: [32]u8 = undefined;
    try ForkTypes(fork).ExecutionRequests.hashTreeRoot(allocator, requests, &requests_root);
    if (!std.mem.eql(u8, &requests_root, &parent_bid.execution_requests_root)) {
        return error.ParentExecutionRequestsRootMismatch;
    }

    try applyParentExecutionPayload(fork, allocator, io, config, epoch_cache, state, requests);
}

pub fn applyParentExecutionPayload(
    comptime fork: ForkSeq,
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    requests: *const ForkTypes(fork).ExecutionRequests.Type,
) !void {
    try validateExecutionRequests(fork, requests);
    var parent_bid = ForkTypes(fork).ExecutionPayloadBid.default_value;
    defer ForkTypes(fork).ExecutionPayloadBid.deinit(allocator, &parent_bid);
    try state.inner.getValue(allocator, "latest_execution_payload_bid", &parent_bid);
    const parent_slot = try state.latestBlockHeaderSlot();
    const parent_epoch = computeEpochAtSlot(parent_slot);
    const current_epoch = computeEpochAtSlot(try state.slot());

    if (parent_epoch == current_epoch) {
        try settleBuilderPayment(fork, allocator, state, preset.SLOTS_PER_EPOCH + (parent_slot % preset.SLOTS_PER_EPOCH));
    } else if (parent_epoch + 1 == current_epoch) {
        try settleBuilderPayment(fork, allocator, state, parent_slot % preset.SLOTS_PER_EPOCH);
    } else if (parent_bid.value > 0) {
        var builder_pending_withdrawals = try state.inner.get("builder_pending_withdrawals");
        const withdrawal = ForkTypes(fork).BuilderPendingWithdrawal.Type{
            .fee_recipient = parent_bid.fee_recipient,
            .amount = parent_bid.value,
            .builder_index = parent_bid.builder_index,
        };
        try builder_pending_withdrawals.pushValue(&withdrawal);
        try state.inner.set("builder_pending_withdrawals", builder_pending_withdrawals);
    }

    for (requests.deposits.items) |*deposit| {
        try processDepositRequest(fork, state, deposit);
    }

    for (requests.withdrawals.items) |*withdrawal| {
        try processWithdrawalRequest(fork, io, config, epoch_cache, state, withdrawal);
    }

    for (requests.consolidations.items) |*consolidation| {
        try processConsolidationRequest(fork, io, config, epoch_cache, state, consolidation);
    }

    if (requests.builder_deposits.items.len > 0 or requests.builder_exits.items.len > 0) {
        var indexed = try IndexedBuilderState(fork).init(allocator, io, state);
        defer indexed.deinit();
        for (requests.builder_deposits.items) |*request| try processBuilderDepositRequest(fork, allocator, config, state, request, &indexed);
        for (requests.builder_exits.items) |*request| try processBuilderExitRequest(fork, allocator, config, state, request, &indexed);
    }

    var execution_payload_availability = try state.inner.get("execution_payload_availability");
    try execution_payload_availability.set(parent_slot % preset.SLOTS_PER_HISTORICAL_ROOT, true);
    try state.inner.set("execution_payload_availability", execution_payload_availability);
    try state.inner.setValue("latest_block_hash", &parent_bid.block_hash);
}

fn settleBuilderPayment(comptime fork: ForkSeq, allocator: Allocator, state: *BeaconState(fork), payment_index: u64) !void {
    var builder_pending_payments = try state.inner.get("builder_pending_payments");
    if (payment_index >= 2 * preset.SLOTS_PER_EPOCH) return error.InvalidBuilderPendingPaymentIndex;

    var payment: ForkTypes(fork).BuilderPendingPayment.Type = undefined;
    try builder_pending_payments.getValue(allocator, payment_index, &payment);
    if (payment.withdrawal.amount > 0) {
        var builder_pending_withdrawals = try state.inner.get("builder_pending_withdrawals");
        try builder_pending_withdrawals.pushValue(&payment.withdrawal);
        try state.inner.set("builder_pending_withdrawals", builder_pending_withdrawals);
    }

    const default_payment = ForkTypes(fork).BuilderPendingPayment.default_value;
    try builder_pending_payments.setValue(payment_index, &default_payment);
}

pub fn validateExecutionRequests(comptime fork: ForkSeq, requests: *const ForkTypes(fork).ExecutionRequests.Type) !void {
    if (requests.withdrawals.items.len > preset.MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD or
        requests.consolidations.items.len > preset.MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD or
        requests.builder_deposits.items.len > preset.MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD or
        requests.builder_exits.items.len > preset.MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD)
    {
        return error.TooManyExecutionRequests;
    }
}

test {
    _ = @import("process_parent_execution_payload_test.zig");
}
