const std = @import("std");
const preset = @import("preset").preset;
const RefCount = @import("../utils/ref_count.zig").RefCount;
const PubkeyHashContext = @import("pubkey_cache.zig").PubkeyHashContext;

pub const max_deposits_per_call = 10_000;
pub const max_cached_deposits = 2 * preset.SLOTS_PER_EPOCH * max_deposits_per_call;
pub const BuilderDepositSignatureCacheRc = RefCount(BuilderDepositSignatureCache);

/// Signature results are independent of queue order and shared across state clones and reloads.
/// Access must stay on the owning state thread. Keys are PendingDeposit hash tree roots, not
/// recycled node IDs or deposit indexes.
///
/// The deposit domain is fork-agnostic and fixed per network since it is always
/// `compute_domain(DOMAIN_DEPOSIT, GENESIS_FORK_VERSION, ZERO_HASH)`,
/// so it is not needed as part of the key.
pub const BuilderDepositSignatureCache = struct {
    /// This cache is keyed by `pubkey_context.hash_key` only because of convenience;
    /// since the same hash key is used in `builder_pubkeys` anyway, so we reuse it.
    /// In reality, there is no coupling at all.
    const RootContext = struct {
        pubkey_context: PubkeyHashContext,

        pub fn hash(self: RootContext, root: [32]u8) u32 {
            return @truncate(std.hash.SipHash64(1, 3).toInt(&root, &self.pubkey_context.hash_key));
        }

        pub fn eql(_: RootContext, lhs: [32]u8, rhs: [32]u8, _: usize) bool {
            return std.mem.eql(u8, &lhs, &rhs);
        }
    };

    validity: std.array_hash_map.Custom([32]u8, bool, RootContext, true) = .empty,
    speculative_validity: std.array_hash_map.Custom([32]u8, bool, RootContext, true) = .empty,
    builder_pubkeys: std.array_hash_map.Custom([48]u8, void, PubkeyHashContext, true) = .empty,
    hash_context: PubkeyHashContext,
    validity_context: RootContext,
    scan_cursor: usize = 0,
    speculative_scan_cursor: usize = 0,
    capacity: usize = max_cached_deposits,

    pub fn deinit(self: *BuilderDepositSignatureCache, allocator: std.mem.Allocator) void {
        self.clear(allocator);
    }

    pub fn clear(self: *BuilderDepositSignatureCache, allocator: std.mem.Allocator) void {
        self.validity.deinit(allocator);
        self.speculative_validity.deinit(allocator);
        self.builder_pubkeys.deinit(allocator);
        self.validity = .empty;
        self.speculative_validity = .empty;
        self.builder_pubkeys = .empty;
        self.scan_cursor = 0;
        self.speculative_scan_cursor = 0;
    }

    pub fn get(self: *const BuilderDepositSignatureCache, deposit_root: [32]u8) ?bool {
        return self.validity.getContext(deposit_root, self.validity_context) orelse
            self.speculative_validity.getContext(deposit_root, self.validity_context);
    }

    pub fn count(self: *const BuilderDepositSignatureCache) usize {
        return self.validity.count() + self.speculative_validity.count();
    }

    pub fn speculativeCapacity(self: *const BuilderDepositSignatureCache) usize {
        return @min(self.capacity / 2 - self.speculative_validity.count(), self.capacity - self.count());
    }

    /// Only insert results from full deposit proof-of-possession verification, including
    /// public-key and signature subgroup/infinity checks. Builder-related results can evict
    /// speculative entries; once all capacity holds builder-related results, new roots miss.
    pub fn put(
        self: *BuilderDepositSignatureCache,
        allocator: std.mem.Allocator,
        pending_deposit_root: [32]u8,
        valid: bool,
    ) !void {
        const context = self.validity_context;
        if (self.validity.getPtrContext(pending_deposit_root, context)) |value| {
            std.debug.assert(value.* == valid);
            return;
        }
        if (self.validity.count() >= self.capacity) return;
        if (self.speculative_validity.getContext(pending_deposit_root, context)) |value| {
            std.debug.assert(value == valid);
        }
        try self.validity.ensureUnusedCapacityContext(allocator, 1, context);
        if (!self.speculative_validity.swapRemoveContext(pending_deposit_root, context) and self.count() >= self.capacity) {
            std.debug.assert(self.speculative_validity.count() > 0);
            self.speculative_validity.swapRemoveAtContext(self.speculative_validity.count() - 1, context);
        }
        self.validity.putAssumeCapacityNoClobberContext(pending_deposit_root, valid, context);
    }

    /// Requires the same full proof-of-possession verification as put(). Unknown validator
    /// results use at most half the shared capacity and may be evicted for builder-related work.
    pub fn putSpeculative(
        self: *BuilderDepositSignatureCache,
        allocator: std.mem.Allocator,
        pending_deposit_root: [32]u8,
        valid: bool,
    ) !void {
        if (self.get(pending_deposit_root)) |value| {
            std.debug.assert(value == valid);
            return;
        }
        if (self.speculativeCapacity() == 0) return;
        try self.speculative_validity.putContext(allocator, pending_deposit_root, valid, self.validity_context);
    }

    pub fn addBuilderPubkey(self: *BuilderDepositSignatureCache, allocator: std.mem.Allocator, pubkey: [48]u8) !void {
        if (self.builder_pubkeys.count() >= self.capacity) return;
        try self.builder_pubkeys.putContext(allocator, pubkey, {}, self.hash_context);
    }

    pub fn isBuilderPubkey(self: *const BuilderDepositSignatureCache, pubkey: [48]u8) bool {
        return self.builder_pubkeys.containsContext(pubkey, self.hash_context);
    }
};

test {
    _ = @import("builder_deposit_signature_cache_test.zig");
}
