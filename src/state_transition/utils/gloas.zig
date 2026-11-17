const std = @import("std");
const Allocator = std.mem.Allocator;
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const ForkTypes = @import("fork_types").ForkTypes;
const ct = @import("consensus_types");
const preset = @import("preset").preset;
const c = @import("constants");
const getBlockRootAtSlot = @import("./block_root.zig").getBlockRootAtSlot;
const computeEpochAtSlot = @import("./epoch.zig").computeEpochAtSlot;
const RootCache = @import("../cache/root_cache.zig").RootCache;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const computeDomain = @import("./domain.zig").computeDomain;
const computeSigningRoot = @import("./signing_root.zig").computeSigningRoot;
const bls = @import("bls");
const verify = @import("./bls.zig").verify;
const EpochShuffling = @import("./epoch_shuffling.zig").EpochShuffling;
const isActiveValidator = @import("./validator.zig").isActiveValidator;
const computeEpochShufflingForFork = @import("./epoch_shuffling.zig").computeEpochShufflingForFork;
const computePayloadTimelinessCommitteesForEpoch = @import("./seed.zig").computePayloadTimelinessCommitteesForEpoch;

const BLSPubkey = ct.primitive.BLSPubkey.Type;
const ValidatorIndex = ct.primitive.ValidatorIndex.Type;
const ExecutionAddress = ct.primitive.ExecutionAddress.Type;
const BLSSignature = ct.primitive.BLSSignature.Type;

pub fn isBuilderWithdrawalCredential(withdrawal_credentials: *const [32]u8) bool {
    return withdrawal_credentials[0] == c.BUILDER_WITHDRAWAL_PREFIX;
}

pub fn getBuilderPaymentQuorumThreshold(epoch_cache: *const EpochCache) u64 {
    const quorum = (epoch_cache.total_active_balance_increments * preset.EFFECTIVE_BALANCE_INCREMENT / preset.SLOTS_PER_EPOCH) *
        c.BUILDER_PAYMENT_THRESHOLD_NUMERATOR;
    return quorum / c.BUILDER_PAYMENT_THRESHOLD_DENOMINATOR;
}

fn hasBuilderIndexFlag(index: u64) bool {
    return (index & c.BUILDER_INDEX_FLAG) != 0;
}

pub fn isBuilderIndex(validator_index: u64) bool {
    return hasBuilderIndexFlag(validator_index);
}

pub fn convertBuilderIndexToValidatorIndex(builder_index: u64) u64 {
    return if (hasBuilderIndexFlag(builder_index)) builder_index else builder_index | c.BUILDER_INDEX_FLAG;
}

pub fn convertValidatorIndexToBuilderIndex(validator_index: u64) u64 {
    return if (hasBuilderIndexFlag(validator_index)) validator_index & ~c.BUILDER_INDEX_FLAG else validator_index;
}

pub fn isActiveBuilder(comptime fork: ForkSeq, builder: *const ForkTypes(fork).Builder.Type, finalized_epoch: u64) bool {
    return builder.deposit_epoch < finalized_epoch and builder.withdrawable_epoch == c.FAR_FUTURE_EPOCH;
}

pub fn getExpectedGasLimit(parent_gas_limit: u64, target_gas_limit: u64) u64 {
    const max_gas_limit_difference = @max(parent_gas_limit / 1024, 1) - 1;

    if (target_gas_limit > parent_gas_limit) {
        return parent_gas_limit + @min(target_gas_limit - parent_gas_limit, max_gas_limit_difference);
    }

    return parent_gas_limit - @min(parent_gas_limit - target_gas_limit, max_gas_limit_difference);
}

pub fn isGasLimitTargetCompatible(parent_gas_limit: u64, gas_limit: u64, target_gas_limit: u64) bool {
    return gas_limit == getExpectedGasLimit(parent_gas_limit, target_gas_limit);
}

pub fn getPendingBalanceToWithdrawForBuilder(comptime fork: ForkSeq, state: *BeaconState(fork), builder_index: u64) !u64 {
    var pending_balance: u64 = 0;

    var withdrawals = try state.inner.getReadonly("builder_pending_withdrawals");
    try withdrawals.commit();
    const withdrawals_len = try withdrawals.length();
    var w_it = withdrawals.iteratorReadonly(0);
    for (0..withdrawals_len) |_| {
        const w = try w_it.nextValue();
        if (w.builder_index == builder_index) {
            pending_balance = try std.math.add(u64, pending_balance, w.amount);
        }
    }

    var payments = try state.inner.getReadonly("builder_pending_payments");
    const payments_len = ForkTypes(fork).BeaconState.getFieldType("builder_pending_payments").length;
    for (0..payments_len) |i| {
        var p: ForkTypes(fork).BuilderPendingPayment.Type = undefined;
        try payments.getValue(undefined, i, &p);
        if (p.withdrawal.builder_index == builder_index) {
            pending_balance = try std.math.add(u64, pending_balance, p.withdrawal.amount);
        }
    }

    return pending_balance;
}

pub fn canBuilderCoverBid(comptime fork: ForkSeq, state: *BeaconState(fork), builder_index: u64, bid_amount: u64) !bool {
    var builders = try state.inner.getReadonly("builders");
    var builder: ForkTypes(fork).Builder.Type = undefined;
    try builders.getValue(undefined, builder_index, &builder);

    const pending_balance = try getPendingBalanceToWithdrawForBuilder(fork, state, builder_index);
    const min_balance = std.math.add(u64, preset.MIN_DEPOSIT_AMOUNT, pending_balance) catch return false;

    if (builder.balance < min_balance) return false;
    return builder.balance - min_balance >= bid_amount;
}

pub fn initiateBuilderExit(comptime fork: ForkSeq, config: *const BeaconConfig, state: *BeaconState(fork), builder_index: u64) !void {
    var builders = try state.inner.get("builders");
    var builder: ForkTypes(fork).Builder.Type = undefined;
    try builders.getValue(undefined, builder_index, &builder);

    if (builder.withdrawable_epoch != c.FAR_FUTURE_EPOCH) return;

    const current_epoch = computeEpochAtSlot(try state.slot());
    builder.withdrawable_epoch = current_epoch + config.chain.MIN_BUILDER_WITHDRAWABILITY_DELAY;
    try builders.setValue(builder_index, &builder);
}

pub fn findBuilderIndexByPubkey(comptime fork: ForkSeq, allocator: Allocator, state: *BeaconState(fork), pubkey: *const BLSPubkey) !?usize {
    var builders = try state.inner.getReadonly("builders");
    const len = try builders.length();
    for (0..len) |i| {
        var b: ForkTypes(fork).Builder.Type = undefined;
        try builders.getValue(allocator, i, &b);
        if (std.mem.eql(u8, &b.pubkey, pubkey)) return i;
    }
    return null;
}

pub fn addBuilderToRegistry(
    comptime fork: ForkSeq,
    allocator: Allocator,
    state: *BeaconState(fork),
    pubkey: *const BLSPubkey,
    version: u8,
    execution_address: *const ExecutionAddress,
    amount: u64,
    slot: u64,
) !void {
    var builders = try state.inner.get("builders");
    const len = try builders.length();
    const current_epoch = computeEpochAtSlot(try state.slot());

    var builder_index: ?usize = null;
    for (0..len) |i| {
        var builder: ForkTypes(fork).Builder.Type = undefined;
        try builders.getValue(allocator, i, &builder);
        if (builder.withdrawable_epoch <= current_epoch and builder.balance == 0) {
            builder_index = i;
            break;
        }
    }

    const new_builder = ForkTypes(fork).Builder.Type{
        .pubkey = pubkey.*,
        .version = version,
        .execution_address = execution_address.*,
        .balance = amount,
        .deposit_epoch = computeEpochAtSlot(slot),
        .withdrawable_epoch = c.FAR_FUTURE_EPOCH,
    };

    if (builder_index) |idx| {
        try builders.setValue(idx, &new_builder);
    } else {
        try builders.pushValue(&new_builder);
        try state.inner.set("builders", builders);
    }
}

pub fn isValidBuilderDepositSignature(
    config: *const BeaconConfig,
    pubkey: *const BLSPubkey,
    withdrawal_credentials: *const [32]u8,
    amount: u64,
    deposit_signature: BLSSignature,
) bool {
    const deposit_message = ct.phase0.DepositMessage.Type{
        .pubkey = pubkey.*,
        .withdrawal_credentials = withdrawal_credentials.*,
        .amount = amount,
    };

    var domain: ct.primitive.Domain.Type = undefined;
    computeDomain(c.DOMAIN_BUILDER_DEPOSIT, config.chain.GENESIS_FORK_VERSION, c.ZERO_HASH, &domain) catch return false;

    var signing_root: [32]u8 = undefined;
    computeSigningRoot(ct.phase0.DepositMessage, &deposit_message, &domain, &signing_root) catch return false;

    const public_key = bls.PublicKey.uncompress(pubkey) catch return false;
    public_key.validate() catch return false;
    const signature = bls.Signature.uncompress(&deposit_signature) catch return false;
    signature.validate(true) catch return false;
    verify(&signing_root, &public_key, &signature, .{}) catch return false;
    return true;
}

pub fn isAttestationSameSlot(comptime fork: ForkSeq, state: *BeaconState(fork), data: *const ct.phase0.AttestationData.Type) !bool {
    if (data.slot == 0) return true;

    const block_root = try getBlockRootAtSlot(fork, state, data.slot);
    const is_matching = std.mem.eql(u8, &data.beacon_block_root, block_root);

    const prev_block_root = try getBlockRootAtSlot(fork, state, data.slot - 1);
    const is_current = !std.mem.eql(u8, &data.beacon_block_root, prev_block_root);

    return is_matching and is_current;
}

pub fn isAttestationSameSlotRootCache(comptime fork: ForkSeq, root_cache: *RootCache(fork), data: *const ct.phase0.AttestationData.Type) !bool {
    if (data.slot == 0) return true;

    const block_root = try root_cache.getBlockRootAtSlot(data.slot);
    const is_matching = std.mem.eql(u8, &data.beacon_block_root, block_root);

    const prev_block_root = try root_cache.getBlockRootAtSlot(data.slot - 1);
    const is_current = !std.mem.eql(u8, &data.beacon_block_root, prev_block_root);

    return is_matching and is_current;
}

pub fn isParentBlockFull(comptime fork: ForkSeq, state: *BeaconState(fork)) !bool {
    var bid = try state.inner.getReadonly("latest_execution_payload_bid");
    const bid_block_hash = try bid.getFieldRoot("block_hash");
    const latest_block_hash = try state.inner.getFieldRoot("latest_block_hash");
    return std.mem.eql(u8, bid_block_hash, latest_block_hash);
}

pub fn initializePtcWindow(
    comptime fork: ForkSeq,
    allocator: Allocator,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
) !ct.gloas.PtcWindow.Type {
    var window = ct.gloas.PtcWindow.default_value;
    const current_epoch = computeEpochAtSlot(try state.slot());
    for (0..1 + preset.MIN_SEED_LOOKAHEAD) |epoch_offset| {
        const epoch = current_epoch + epoch_offset;
        var owned_shuffling: ?*EpochShuffling = null;
        defer if (owned_shuffling) |shuffling| shuffling.deinit();
        const shuffling = epoch_cache.getShufflingAtEpochOrNull(epoch) orelse blk: {
            var validators = try state.validators();
            const count = try validators.length();
            if (count > std.math.maxInt(u32)) return error.InvalidValidatorCount;
            var active: std.ArrayList(u32) = .empty;
            defer active.deinit(allocator);
            try active.ensureTotalCapacity(allocator, count);
            var it = validators.iteratorReadonly(0);
            for (0..count) |i| {
                const validator = try it.nextValuePtr();
                if (isActiveValidator(validator, epoch)) active.appendAssumeCapacity(@intCast(i));
            }
            const indices = try active.toOwnedSlice(allocator);
            errdefer allocator.free(indices);
            owned_shuffling = try computeEpochShufflingForFork(fork, allocator, state, indices, epoch);
            break :blk owned_shuffling.?;
        };
        const committees = try computePayloadTimelinessCommitteesForEpoch(
            fork,
            state,
            epoch,
            shuffling,
            epoch_cache.getEffectiveBalanceIncrements().items,
        );
        @memcpy(window[(epoch_offset + 1) * preset.SLOTS_PER_EPOCH ..][0..preset.SLOTS_PER_EPOCH], &committees);
    }
    return window;
}

pub fn getPayloadTimelinessCommittee(comptime fork: ForkSeq, config: *const BeaconConfig, state: *BeaconState(fork), slot: u64, out: *ForkTypes(fork).PayloadTimelinessCommittee.Type) !void {
    const current_epoch = computeEpochAtSlot(try state.slot());
    const epoch = computeEpochAtSlot(slot);
    if (epoch < config.chain.GLOAS_FORK_EPOCH) return error.PayloadTimelinessCommitteeBeforeGloas;
    if (epoch + 1 < current_epoch or epoch > current_epoch + preset.MIN_SEED_LOOKAHEAD) return error.PayloadTimelinessCommitteeOutOfRange;
    const epoch_offset = epoch + 1 - current_epoch;
    var window = try state.inner.getReadonly("ptc_window");
    try window.getValue(undefined, epoch_offset * preset.SLOTS_PER_EPOCH + slot % preset.SLOTS_PER_EPOCH, out);
}

test {
    _ = @import("gloas_test.zig");
}
