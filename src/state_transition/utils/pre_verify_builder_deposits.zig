const std = @import("std");
const bls = @import("bls");
const time = @import("time");
const ct = @import("consensus_types");
const CachedBeaconState = @import("../cache/state_cache.zig").CachedBeaconState;
const cache_module = @import("../cache/builder_deposit_signature_cache.zig");
const deposit_module = @import("../block/process_deposit.zig");
const isBuilderWithdrawalCredential = @import("gloas.zig").isBuilderWithdrawalCredential;
const isValidatorKnown = @import("electra.zig").isValidatorKnown;
const PubkeyHashContext = @import("../cache/pubkey_cache.zig").PubkeyHashContext;

pub const max_scanned_deposits_per_call = 100_000;
const batch_size = deposit_module.deposit_signature_batch_size;

pub const PreVerifyBuilderDepositsResult = struct {
    valid_builder_signatures_count: usize = 0,
    invalid_builder_signatures_count: usize = 0,
    valid_validator_signatures_count: usize = 0,
    invalid_validator_signatures_count: usize = 0,
    scanned_pending_deposits: usize = 0,
    total_cached_deposits: usize = 0,
    total_builder_pubkeys: usize = 0,
    pending_deposits_count: usize = 0,
};

/// Called on committed Fulu head states during the scheduler's pre-Gloas window.
/// Both scanning and BLS share one deadline, checked every batch. Unknown validator
/// deposits are checked before a builder trigger arrives, including invalid prefixes.
/// A valid deposit can suppress only later entries in this scan, never earlier entries
/// or entries in another state. A cache miss still falls back to verification at the fork.
pub fn preVerifyBuilderDepositsPreGloas(
    io: std.Io,
    pool: *bls.ThreadPool,
    state: *CachedBeaconState,
    max_deposits: usize,
    max_duration_ms: u64,
) !PreVerifyBuilderDepositsResult {
    if (state.state.forkSeq() != .fulu) return error.ExpectedFuluState;
    const started = time.start(io);
    const cache_rc = state.epoch_cache.builder_deposit_signature_cache;
    const cache = &cache_rc.instance;
    const allocator = cache_rc.allocator;
    var pending = try state.state.castToFork(.fulu).pendingDeposits();
    const len = try pending.length();
    var result: PreVerifyBuilderDepositsResult = .{ .pending_deposits_count = len };
    const verification_limit = @min(max_deposits, cache_module.max_deposits_per_call);
    const scan_limit = @min(len, max_scanned_deposits_per_call);
    // Unlike the NodeJS scanner, which rescans from 0 each tick so a forked head state's
    // different pendingDeposits gets full coverage, the scan resumes from the persisted cursor
    // because each scanned element here decodes a value and runs a validator-known lookup.
    // The cursor stays correct when the list changes (fork, epoch compaction, appends): the
    // cache is keyed by deposit root, not list position, and the cursor wraps to 0 at the list
    // end, so entries shifted before the cursor are pre-verified at most one wrap cycle late.
    // The fork transition verifies on cache miss, so this timing difference costs CPU only,
    // never correctness.
    const start_cursor = if (cache.scan_cursor < len) cache.scan_cursor else 0;
    cache.scan_cursor = start_cursor;
    errdefer cache.scan_cursor = start_cursor;
    var iterator = pending.iteratorReadonly(start_cursor);
    var verified: usize = 0;
    var batch_verify = true;
    var resolved: std.array_hash_map.Custom([48]u8, void, PubkeyHashContext, true) = .empty;
    defer resolved.deinit(allocator);

    while (result.scanned_pending_deposits < scan_limit and verified < verification_limit and cache.validity.count() < cache.capacity) {
        var deposits: [batch_size]ct.electra.PendingDeposit.Type = undefined;
        var count: usize = 0;
        const scan_count = @min(batch_size, scan_limit - result.scanned_pending_deposits);
        const batch_limit = @min(verification_limit - verified, cache.capacity - cache.validity.count());
        for (0..scan_count) |_| {
            if (count == batch_limit) break;
            const deposit = try iterator.nextValue();
            result.scanned_pending_deposits += 1;
            cache.scan_cursor += 1;
            if (isBuilderWithdrawalCredential(&deposit.withdrawal_credentials)) {
                try cache.addBuilderPubkey(allocator, deposit.pubkey);
            }
            const known = try isValidatorKnown(
                .fulu,
                state.state.castToFork(.fulu),
                state.epoch_cache.pubkey_cache.get(io, deposit.pubkey),
            );
            if (!known and !resolved.containsContext(deposit.pubkey, cache.hash_context)) {
                if (try cache.get(state.config, &deposit)) |valid| {
                    if (valid and resolved.count() < cache_module.max_deposits_per_call) try resolved.putContext(
                        allocator,
                        deposit.pubkey,
                        {},
                        cache.hash_context,
                    );
                } else {
                    deposits[count] = deposit;
                    count += 1;
                }
            }
            if (cache.scan_cursor == len) break;
        }
        if (count > 0) {
            var results: [batch_size]bool = undefined;
            try deposit_module.verifyDepositSignatures(io, pool, state.config, deposits[0..count], results[0..count], batch_verify);
            // Avoid repeating pairings in an invalid flood; resume batching after an all-valid chunk.
            batch_verify = std.mem.allEqual(bool, results[0..count], true);
            for (deposits[0..count], results[0..count]) |*deposit, valid| {
                try cache.put(allocator, state.config, deposit, valid);
                const is_builder = isBuilderWithdrawalCredential(&deposit.withdrawal_credentials);
                if (valid) {
                    if (resolved.count() < cache_module.max_deposits_per_call)
                        try resolved.putContext(allocator, deposit.pubkey, {}, cache.hash_context);
                    if (is_builder)
                        result.valid_builder_signatures_count += 1
                    else
                        result.valid_validator_signatures_count += 1;
                } else {
                    if (is_builder)
                        result.invalid_builder_signatures_count += 1
                    else
                        result.invalid_validator_signatures_count += 1;
                }
            }
            verified += count;
        }
        if (cache.scan_cursor == len) {
            cache.scan_cursor = 0;
            iterator = pending.iteratorReadonly(0);
            resolved.clearRetainingCapacity();
        }
        if (time.since(io, started).toMilliseconds() >= max_duration_ms) break;
    }
    result.total_cached_deposits = cache.validity.count();
    result.total_builder_pubkeys = cache.builder_pubkeys.count();
    return result;
}

test {
    _ = @import("pre_verify_builder_deposits_test.zig");
}
