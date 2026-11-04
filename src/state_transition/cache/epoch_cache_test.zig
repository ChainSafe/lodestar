//! Tests for `epoch_cache.zig`.

const std = @import("std");
const ct = @import("consensus_types");
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const SyncCommitteeCache = @import("sync_committee_cache.zig").SyncCommitteeCache;
const EpochCache = @import("epoch_cache.zig").EpochCache;
const SyncCommitteeCacheRc = @import("sync_committee_cache.zig").SyncCommitteeCacheRc;
const EffectiveBalanceIncrementsRc = @import("effective_balance_increments.zig").EffectiveBalanceIncrementsRc;
const effectiveBalanceIncrementsInit = @import("effective_balance_increments.zig").effectiveBalanceIncrementsInit;
const SLOTS_PER_EPOCH = @import("preset").preset.SLOTS_PER_EPOCH;

test "memory_safety: createFromState releases shuffling inputs on every allocation failure" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();
    const state = test_state.cached_state.state;
    const immutable_data = @import("epoch_cache.zig").EpochCacheImmutableData{
        .config = test_state.config,
        .pubkey_cache = test_state.pubkey_cache,
    };
    const options = @import("epoch_cache.zig").EpochCacheOpts{
        .skip_sync_committee_cache = true,
        .skip_sync_pubkeys = true,
    };

    var counting = std.testing.FailingAllocator.init(allocator, .{});
    const cache = try EpochCache.createFromState(counting.allocator(), std.testing.io, state, immutable_data, options);
    cache.deinit();
    const allocation_count = counting.alloc_index;
    try std.testing.expectEqual(counting.allocated_bytes, counting.freed_bytes);

    for (0..allocation_count) |fail_index| {
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = fail_index });
        try std.testing.expectError(
            error.OutOfMemory,
            EpochCache.createFromState(failing.allocator(), std.testing.io, state, immutable_data, options),
        );
        try std.testing.expect(failing.has_induced_failure);
        try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
    }
}

test "memory_safety: setSyncCommitteesIndexed should release each cache once on allocation failure" {
    const allocator = std.testing.allocator;
    const ValidatorIndex = ct.primitive.ValidatorIndex.Type;
    const indices = [_]ValidatorIndex{ 0, 0, 2 };
    var counting_allocator = std.testing.FailingAllocator.init(allocator, .{});
    var cache = try SyncCommitteeCache.initValidatorIndices(counting_allocator.allocator(), &indices);
    const cache_allocations = counting_allocator.alloc_index;
    cache.deinit();

    // Fail either RC allocation or the first allocation after the next cache transfers to its RC.
    const failure_indices = [_]usize{ cache_allocations, cache_allocations + 1, 2 * cache_allocations + 1 };
    for (failure_indices) |fail_index| {
        var failing_allocator = std.testing.FailingAllocator.init(allocator, .{ .fail_index = fail_index });
        var epoch_cache: EpochCache = undefined;
        epoch_cache.allocator = failing_allocator.allocator();
        epoch_cache.current_sync_committee_indexed = try SyncCommitteeCacheRc.create(allocator, .initEmpty());
        defer epoch_cache.current_sync_committee_indexed.unref();

        epoch_cache.next_sync_committee_indexed = try SyncCommitteeCacheRc.create(allocator, .initEmpty());
        defer epoch_cache.next_sync_committee_indexed.unref();

        const old_current = epoch_cache.current_sync_committee_indexed;
        const old_next = epoch_cache.next_sync_committee_indexed;
        try std.testing.expectError(error.OutOfMemory, epoch_cache.setSyncCommitteesIndexed(&indices));
        try std.testing.expect(failing_allocator.has_induced_failure);
        try std.testing.expectEqual(old_current, epoch_cache.current_sync_committee_indexed);
        try std.testing.expectEqual(old_next, epoch_cache.next_sync_committee_indexed);
        try std.testing.expectEqual(failing_allocator.allocated_bytes, failing_allocator.freed_bytes);

        failing_allocator.fail_index = std.math.maxInt(usize);
        try epoch_cache.setSyncCommitteesIndexed(&indices);
        try std.testing.expectEqualSlices(ValidatorIndex, &indices, try epoch_cache.current_sync_committee_indexed.get().getValidatorIndices());
        try std.testing.expectEqualSlices(ValidatorIndex, &indices, try epoch_cache.next_sync_committee_indexed.get().getValidatorIndices());
    }
}

test "memory_safety: setSyncCommitteesIndexed should preserve caches on every OOM" {
    const ValidatorIndex = ct.primitive.ValidatorIndex.Type;
    const indices = [_]ValidatorIndex{ 0, 0, 2 };
    var accounting = std.testing.FailingAllocator.init(std.testing.allocator, .{});

    try std.testing.checkAllAllocationFailures(accounting.allocator(), struct {
        fn run(
            allocator: std.mem.Allocator,
            input: []const ValidatorIndex,
            counter: *const std.testing.FailingAllocator,
        ) !void {
            var epoch_cache: EpochCache = undefined;
            epoch_cache.allocator = allocator;
            epoch_cache.current_sync_committee_indexed = try SyncCommitteeCacheRc.create(
                std.testing.allocator,
                .initEmpty(),
            );
            defer epoch_cache.current_sync_committee_indexed.unref();

            epoch_cache.next_sync_committee_indexed = try SyncCommitteeCacheRc.create(
                std.testing.allocator,
                .initEmpty(),
            );
            defer epoch_cache.next_sync_committee_indexed.unref();

            const old_current = epoch_cache.current_sync_committee_indexed;
            const old_next = epoch_cache.next_sync_committee_indexed;
            const outstanding_bytes = counter.allocated_bytes - counter.freed_bytes;
            epoch_cache.setSyncCommitteesIndexed(input) catch |err| {
                try std.testing.expectEqual(old_current, epoch_cache.current_sync_committee_indexed);
                try std.testing.expectEqual(old_next, epoch_cache.next_sync_committee_indexed);
                try std.testing.expectEqual(
                    outstanding_bytes,
                    counter.allocated_bytes - counter.freed_bytes,
                );
                return err;
            };
            try std.testing.expectEqualSlices(
                ValidatorIndex,
                input,
                try epoch_cache.current_sync_committee_indexed.get().getValidatorIndices(),
            );
            try std.testing.expectEqualSlices(
                ValidatorIndex,
                input,
                try epoch_cache.next_sync_committee_indexed.get().getValidatorIndices(),
            );
        }
    }.run, .{ &indices, &accounting });
}

test "memory_safety: rotateSyncCommitteeIndexed should preserve shared caches on allocation failure" {
    const allocator = std.testing.allocator;
    const ValidatorIndex = ct.primitive.ValidatorIndex.Type;
    const indices = [_]ValidatorIndex{ 0, 0, 2 };
    var counting_allocator = std.testing.FailingAllocator.init(allocator, .{});
    var cache = try SyncCommitteeCache.initValidatorIndices(counting_allocator.allocator(), &indices);
    const cache_allocations = counting_allocator.alloc_index;
    cache.deinit();

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();
    const pre_cache = test_state.cached_state.epoch_cache;
    const old_current = pre_cache.current_sync_committee_indexed;
    const old_next = pre_cache.next_sync_committee_indexed;
    const current_indices = try allocator.dupe(ValidatorIndex, try old_current.get().getValidatorIndices());
    defer allocator.free(current_indices);
    const next_indices = try allocator.dupe(ValidatorIndex, try old_next.get().getValidatorIndices());
    defer allocator.free(next_indices);

    // Fail the initial allocation and the RC allocation after the raw cache is complete.
    for ([_]usize{ 0, cache_allocations }) |fail_index| {
        var failing_allocator = std.testing.FailingAllocator.init(allocator, .{});
        {
            const candidate = try pre_cache.clone(failing_allocator.allocator());
            defer candidate.deinit();
            failing_allocator.fail_index = failing_allocator.alloc_index + fail_index;

            try std.testing.expectError(error.OutOfMemory, candidate.rotateSyncCommitteeIndexed(&indices));
            try std.testing.expect(failing_allocator.has_induced_failure);
            try std.testing.expectEqual(old_current, candidate.current_sync_committee_indexed);
            try std.testing.expectEqual(old_next, candidate.next_sync_committee_indexed);

            failing_allocator.fail_index = std.math.maxInt(usize);
            try candidate.rotateSyncCommitteeIndexed(&indices);
            try std.testing.expectEqual(old_next, candidate.current_sync_committee_indexed);
            try std.testing.expectEqualSlices(ValidatorIndex, &indices, try candidate.next_sync_committee_indexed.get().getValidatorIndices());
        }
        try std.testing.expectEqual(failing_allocator.allocated_bytes, failing_allocator.freed_bytes);
        try std.testing.expectEqualSlices(ValidatorIndex, current_indices, try pre_cache.current_sync_committee_indexed.get().getValidatorIndices());
        try std.testing.expectEqualSlices(ValidatorIndex, next_indices, try pre_cache.next_sync_committee_indexed.get().getValidatorIndices());
    }
}

test "memory_safety: EpochCache.clone does not retain shared references when allocation fails" {
    const allocator = std.testing.allocator;

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 200_000,
    });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    // Leaked refs prevent test_state teardown from releasing the last shared owners.
    try std.testing.checkAllAllocationFailures(allocator, struct {
        fn run(
            clone_allocator: std.mem.Allocator,
            source: *@import("epoch_cache.zig").EpochCache,
        ) !void {
            const cloned = try source.clone(clone_allocator);
            defer cloned.deinit();
        }
    }.run, .{test_state.cached_state.epoch_cache});
}

test "memory_safety: afterProcessEpoch releases copied indices when RC allocation fails" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();

    var failing = std.testing.FailingAllocator.init(allocator, .{});
    {
        var test_state = try TestCachedBeaconState.init(failing.allocator(), &pool, 256);
        defer test_state.deinit();

        const epoch_cache = test_state.cached_state.epoch_cache;
        const transition_cache = test_state.epoch_transition_cache;
        try std.testing.expect(transition_cache.next_shuffling == null);
        try std.testing.expect(transition_cache.next_shuffling_active_indices.len > 0);
        const previous_shuffling = epoch_cache.previous_shuffling;
        const current_shuffling = epoch_cache.current_shuffling;
        const next_shuffling = epoch_cache.next_shuffling;
        const previous_decision_root = epoch_cache.previous_decision_root;
        const current_decision_root = epoch_cache.current_decision_root;
        const next_decision_root = epoch_cache.next_decision_root;
        const allocated_bytes = failing.allocated_bytes;
        const freed_bytes = failing.freed_bytes;

        // The copied indices allocate first; the RC wrapper allocation must fail next.
        failing.fail_index = failing.alloc_index + 1;
        try std.testing.expectError(
            error.OutOfMemory,
            epoch_cache.afterProcessEpoch(test_state.cached_state.state, transition_cache),
        );
        try std.testing.expect(failing.has_induced_failure);
        const copied_bytes = transition_cache.next_shuffling_active_indices.len * @sizeOf(u32);
        try std.testing.expectEqual(copied_bytes, failing.allocated_bytes - allocated_bytes);
        try std.testing.expectEqual(copied_bytes, failing.freed_bytes - freed_bytes);
        try std.testing.expectEqual(previous_shuffling, epoch_cache.previous_shuffling);
        try std.testing.expectEqual(current_shuffling, epoch_cache.current_shuffling);
        try std.testing.expectEqual(next_shuffling, epoch_cache.next_shuffling);
        try std.testing.expectEqual(previous_decision_root, epoch_cache.previous_decision_root);
        try std.testing.expectEqual(current_decision_root, epoch_cache.current_decision_root);
        try std.testing.expectEqual(next_decision_root, epoch_cache.next_decision_root);
    }
    try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
}

test "memory_safety: afterProcessEpoch should preserve shuffling state when decision-root calculation fails" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    const epoch_cache = test_state.cached_state.epoch_cache;
    const previous_shuffling = epoch_cache.previous_shuffling;
    const current_shuffling = epoch_cache.current_shuffling;
    const next_shuffling = epoch_cache.next_shuffling;
    const previous_decision_root = epoch_cache.previous_decision_root;
    const current_decision_root = epoch_cache.current_decision_root;
    const next_decision_root = epoch_cache.next_decision_root;

    // The replacement shuffling is built before decision-root lookup fails.
    try std.testing.expectError(
        error.SlotTooBig,
        epoch_cache.afterProcessEpoch(
            test_state.cached_state.state,
            test_state.epoch_transition_cache,
        ),
    );

    // The failed update must leave every shuffling owner paired with its original decision root.
    try std.testing.expectEqual(previous_shuffling, epoch_cache.previous_shuffling);
    try std.testing.expectEqual(current_shuffling, epoch_cache.current_shuffling);
    try std.testing.expectEqual(next_shuffling, epoch_cache.next_shuffling);
    try std.testing.expectEqual(previous_decision_root, epoch_cache.previous_decision_root);
    try std.testing.expectEqual(current_decision_root, epoch_cache.current_decision_root);
    try std.testing.expectEqual(next_decision_root, epoch_cache.next_decision_root);
}

test "effectiveBalanceIncrementsAppend grows in place only when the list is not shared" {
    const allocator = std.testing.allocator;
    var epoch_cache: EpochCache = undefined;
    epoch_cache.allocator = allocator;
    {
        var increments = try effectiveBalanceIncrementsInit(allocator, 4);
        errdefer increments.deinit(allocator);
        epoch_cache.effective_balance_increments = try EffectiveBalanceIncrementsRc.create(allocator, increments);
    }
    defer epoch_cache.effective_balance_increments.unref();

    const shared = epoch_cache.effective_balance_increments.ref();
    defer shared.unref();
    try epoch_cache.effectiveBalanceIncrementsAppend(4, 32_000_000_000);
    try std.testing.expect(epoch_cache.effective_balance_increments != shared);
    try std.testing.expectEqual(4, shared.get().items.len);
    try std.testing.expectEqual(5, epoch_cache.effective_balance_increments.get().items.len);

    const unique = epoch_cache.effective_balance_increments;
    const items_ptr = unique.get().items.ptr;
    try epoch_cache.effectiveBalanceIncrementsAppend(5, 1_000_000_000);
    try std.testing.expectEqual(unique, epoch_cache.effective_balance_increments);
    try std.testing.expectEqual(items_ptr, unique.get().items.ptr);
    try std.testing.expectEqualSlices(u16, &.{ 0, 0, 0, 0, 32, 1 }, unique.get().items);
}

test "memory_safety: attesting indices belong to the caller's allocator, not the cache's" {
    var cache_allocator_state: std.heap.DebugAllocator(.{}) = .init;
    defer std.debug.assert(cache_allocator_state.deinit() == .ok);
    const cache_allocator = cache_allocator_state.allocator();
    const caller_allocator = std.testing.allocator;

    var pool = try Node.Pool.init(.{
        .page_allocator = cache_allocator,
        .allocator = cache_allocator,
        .pool_size = 500_000,
    });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(cache_allocator, &pool, 256);
    defer test_state.deinit();

    const epoch_cache = test_state.cached_state.epoch_cache;
    const slot = epoch_cache.epoch * SLOTS_PER_EPOCH;
    const committee = try epoch_cache.getBeaconCommittee(slot, 0);
    try std.testing.expect(committee.len > 0);

    var data = std.mem.zeroes(ct.phase0.AttestationData.Type);
    data.slot = slot;

    var phase0_attestation: ct.phase0.Attestation.Type = .{
        .aggregation_bits = try .fromBitLen(caller_allocator, committee.len),
        .data = data,
        .signature = std.mem.zeroes(ct.primitive.BLSSignature.Type),
    };
    defer phase0_attestation.aggregation_bits.deinit(caller_allocator);
    try phase0_attestation.aggregation_bits.set(caller_allocator, 0, true);

    var electra_attestation: ct.electra.Attestation.Type = .{
        .aggregation_bits = try .fromBitLen(caller_allocator, committee.len),
        .data = data,
        .signature = std.mem.zeroes(ct.primitive.BLSSignature.Type),
        .committee_bits = .empty,
    };
    defer electra_attestation.aggregation_bits.deinit(caller_allocator);
    try electra_attestation.aggregation_bits.set(caller_allocator, 0, true);
    try electra_attestation.committee_bits.set(0, true);

    var phase0_indices = try epoch_cache.getAttestingIndices(.phase0, caller_allocator, &phase0_attestation);
    phase0_indices.deinit(caller_allocator);

    var electra_indices = try epoch_cache.getAttestingIndices(.electra, caller_allocator, &electra_attestation);
    electra_indices.deinit(caller_allocator);

    var indexed: ct.phase0.IndexedAttestation.Type = undefined;
    try epoch_cache.computeIndexedAttestationPhase0(caller_allocator, &phase0_attestation, &indexed);
    ct.phase0.IndexedAttestation.deinit(caller_allocator, &indexed);

    var indexed_electra: ct.electra.IndexedAttestation.Type = undefined;
    try epoch_cache.computeIndexedAttestationElectra(caller_allocator, &electra_attestation, &indexed_electra);
    ct.electra.IndexedAttestation.deinit(caller_allocator, &indexed_electra);
}
