const std = @import("std");
const Allocator = std.mem.Allocator;
const BeaconConfig = @import("config").BeaconConfig;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const ct = @import("consensus_types");
const c = @import("constants");
const preset = @import("preset").preset;
const Node = @import("persistent_merkle_tree").Node;
const gloas = @import("../utils/gloas.zig");
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const validateDepositSignature = @import("../block/process_deposit.zig").validateDepositSignature;
const isValidatorKnown = @import("../utils/electra.zig").isValidatorKnown;
const PubkeyHashContext = @import("../cache/pubkey_cache.zig").PubkeyHashContext;
const BuilderDepositSignatureCache = @import("../cache/builder_deposit_signature_cache.zig").BuilderDepositSignatureCache;
const metrics = @import("../metrics.zig");
const time = @import("time");

/// Consumes fulu_state only on success. Compatible element roots remain shared.
pub fn upgradeStateToGloas(allocator: Allocator, io: std.Io, config: *const BeaconConfig, epoch_cache: *const EpochCache, fulu_state: *BeaconState(.fulu)) !BeaconState(.gloas) {
    try fulu_state.commit();
    var state = try fulu_state.upgradeUnsafe();
    errdefer state.deinit();
    inline for (.{ "validators", "pending_deposits", "pending_partial_withdrawals", "pending_consolidations" }) |field| {
        const Before = ct.fulu.BeaconState.getFieldType(field);
        const After = ct.gloas.BeaconState.getFieldType(field);
        const migrated = try migrateComposite(Before, After, allocator, state.inner.allocator, state.inner.pool, try fulu_state.inner.get(field));
        errdefer migrated.deinit();
        try state.inner.set(field, migrated);
    }
    inline for (.{ "balances", "previous_epoch_participation", "current_epoch_participation", "inactivity_scores" }) |field| {
        var before = try fulu_state.inner.get(field);
        var after = try state.inner.get(field);
        const len = try before.length();
        try after.growTo(len);
        var it = before.iteratorReadonly(0);
        for (0..len) |index| try after.set(index, try it.next());
    }
    const epoch = computeEpochAtSlot(try state.slot());
    try state.setFork(&.{ .previous_version = try fulu_state.forkCurrentVersion(), .current_version = config.chain.GLOAS_FORK_VERSION, .epoch = epoch });
    var header = ct.fulu.ExecutionPayloadHeader.default_value;
    try fulu_state.latestExecutionPayloadHeader(allocator, &header);
    defer ct.fulu.ExecutionPayloadHeader.deinit(allocator, &header);
    var block_header = try fulu_state.latestBlockHeader();
    var bid = ct.gloas.ExecutionPayloadBid.default_value;
    bid.parent_block_hash = header.parent_hash;
    bid.parent_block_root = (try block_header.getFieldRoot("parent_root")).*;
    bid.block_hash = header.block_hash;
    bid.prev_randao = header.prev_randao;
    bid.gas_limit = header.gas_limit;
    bid.builder_index = c.BUILDER_INDEX_SELF_BUILD;
    bid.slot = try block_header.get("slot");
    try ct.gloas.ExecutionRequests.hashTreeRoot(allocator, &ct.gloas.ExecutionRequests.default_value, &bid.execution_requests_root);
    try state.inner.setValue("latest_execution_payload_bid", &bid);
    try state.inner.setValue("latest_block_hash", &header.block_hash);
    var availability = try state.inner.get("execution_payload_availability");
    for (0..preset.SLOTS_PER_HISTORICAL_ROOT) |slot| try availability.set(slot, true);
    const ptc_window = try gloas.initializePtcWindow(.fulu, allocator, epoch_cache, fulu_state);
    try state.inner.setValue("ptc_window", &ptc_window);
    try onboardBuilders(allocator, io, config, epoch_cache, &state);
    try state.commit();
    fulu_state.deinit();
    return state;
}

fn migrateComposite(comptime Before: type, comptime After: type, allocator: Allocator, view_allocator: Allocator, pool: *Node.Pool, before: *Before.TreeView) !*After.TreeView {
    comptime std.debug.assert(Before.Element == After.Element);
    const len = try before.length();
    const nodes = try allocator.alloc(Node.Id, len);
    defer allocator.free(nodes);
    if (len > 0) try before.getRoot().getNodesAtDepth(pool, Before.chunk_depth + 1, 0, nodes);
    const root = try After.tree.fromNodes(pool, nodes);
    errdefer pool.unref(root);
    return After.TreeView.init(view_allocator, pool, root);
}

fn onboardBuilders(allocator: Allocator, io: std.Io, config: *const BeaconConfig, epoch_cache: *const EpochCache, state: *BeaconState(.gloas)) !void {
    const started = time.start(io);
    const signature_cache = &epoch_cache.builder_deposit_signature_cache.instance;
    var checks: SignatureChecks = .{};
    var onboarded: u64 = 0;
    var topups: u64 = 0;
    var kept: u64 = 0;
    var dropped: u64 = 0;
    const Entry = struct {
        builder_index: ?usize = null,
        pending_tail: usize = std.math.maxInt(usize),
        unchecked_head: usize = std.math.maxInt(usize),
        has_pending_validator: bool = false,
    };
    var lookup: std.array_hash_map.Custom([48]u8, Entry, PubkeyHashContext, true) = .empty;
    defer lookup.deinit(allocator);
    const context = epoch_cache.pubkey_cache.hashContext();
    var pending = try state.pendingDeposits();
    try pending.commit();
    const len = try pending.length();
    const next = try allocator.alloc(usize, len);
    defer allocator.free(next);
    var remaining = try ct.gloas.PendingDeposits.TreeView.fromValue(state.inner.allocator, state.inner.pool, &ct.gloas.PendingDeposits.default_value);
    errdefer remaining.deinit();
    var builders = try state.inner.get("builders");
    var it = pending.iteratorReadonly(0);
    for (0..len) |index| {
        const item = try it.nextValueWithRoot();
        const deposit = item.value;
        const result = try lookup.getOrPutContext(allocator, deposit.pubkey, context);
        if (!result.found_existing) result.value_ptr.* = .{};
        const entry = result.value_ptr;
        const validator_index = epoch_cache.pubkey_cache.get(io, deposit.pubkey);
        const known_validator = try isValidatorKnown(.gloas, state, validator_index);
        if (!known_validator) {
            if (entry.builder_index) |builder_index| {
                var builder: ct.gloas.Builder.Type = undefined;
                try builders.getValue(undefined, builder_index, &builder);
                builder.balance = try std.math.add(u64, builder.balance, deposit.amount);
                try builders.setValue(builder_index, &builder);
                topups += 1;
                continue;
            }
            if (gloas.isBuilderWithdrawalCredential(&deposit.withdrawal_credentials)) {
                // Walk oldest first: a valid validator deposit suppresses all later
                // signatures for this pubkey, matching the pre-verification scanner.
                while (!entry.has_pending_validator and entry.unchecked_head != std.math.maxInt(usize)) {
                    const pending_index = entry.unchecked_head;
                    var prior: ct.electra.PendingDeposit.Type = undefined;
                    try pending.getValue(undefined, pending_index, &prior);
                    const prior_root = (try pending.getFieldRoot(pending_index)).*;
                    entry.unchecked_head = next[pending_index];
                    if (!try isValidCachedDeposit(
                        epoch_cache.builder_deposit_signature_cache.allocator,
                        config,
                        signature_cache,
                        &prior,
                        prior_root,
                        &checks,
                    )) {
                        continue;
                    }
                    entry.has_pending_validator = true;
                }
                if (!entry.has_pending_validator) {
                    if (!try isValidCachedDeposit(
                        epoch_cache.builder_deposit_signature_cache.allocator,
                        config,
                        signature_cache,
                        &deposit,
                        item.root,
                        &checks,
                    )) {
                        dropped += 1;
                        continue;
                    }
                    const builder = ct.gloas.Builder.Type{
                        .pubkey = deposit.pubkey,
                        .version = c.PAYLOAD_BUILDER_VERSION,
                        .execution_address = deposit.withdrawal_credentials[12..32].*,
                        .balance = deposit.amount,
                        .deposit_epoch = computeEpochAtSlot(deposit.slot),
                        .withdrawable_epoch = c.FAR_FUTURE_EPOCH,
                    };
                    const builder_index = try builders.length();
                    try builders.pushValue(&builder);
                    entry.builder_index = builder_index;
                    onboarded += 1;
                    continue;
                }
            }
        }
        try remaining.pushValue(&deposit);
        next[index] = std.math.maxInt(usize);
        if (entry.pending_tail != std.math.maxInt(usize)) next[entry.pending_tail] = index;
        if (entry.unchecked_head == std.math.maxInt(usize)) entry.unchecked_head = index;
        entry.pending_tail = index;
        kept += 1;
    }
    metrics.state_transition.onboard_builders.observe(time.durationSeconds(time.since(io, started)));
    metrics.state_transition.onboard_builders_deposits.set(.{ .outcome = .onboarded }, onboarded) catch {};
    metrics.state_transition.onboard_builders_deposits.set(.{ .outcome = .topup }, topups) catch {};
    metrics.state_transition.onboard_builders_deposits.set(.{ .outcome = .kept }, kept) catch {};
    metrics.state_transition.onboard_builders_deposits.set(.{ .outcome = .dropped }, dropped) catch {};
    metrics.state_transition.onboard_builders_signature_checks.set(.{ .source = .cache }, checks.from_cache) catch {};
    metrics.state_transition.onboard_builders_signature_checks.set(.{ .source = .verified }, checks.verified) catch {};
    try state.setPendingDeposits(remaining);
}

const SignatureChecks = struct {
    from_cache: u64 = 0,
    verified: u64 = 0,
};

fn isValidCachedDeposit(
    allocator: Allocator,
    config: *const BeaconConfig,
    cache: *BuilderDepositSignatureCache,
    deposit: *const ct.electra.PendingDeposit.Type,
    deposit_root: [32]u8,
    checks: *SignatureChecks,
) !bool {
    if (cache.get(deposit_root)) |valid| {
        checks.from_cache += 1;
        return valid;
    }
    checks.verified += 1;
    const valid = if (validateDepositSignature(
        config,
        &deposit.pubkey,
        &deposit.withdrawal_credentials,
        deposit.amount,
        deposit.signature,
    )) true else |err| switch (err) {
        error.BadEncoding, error.PointNotOnCurve, error.PointNotInGroup, error.VerifyFail, error.PkIsInfinity => false,
        else => return err,
    };
    cache.put(allocator, deposit_root, valid) catch {};
    return valid;
}

test {
    _ = @import("upgrade_state_to_gloas_test.zig");
}
