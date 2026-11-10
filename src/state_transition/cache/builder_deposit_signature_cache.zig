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
/// so it's fork-agnostic and fixed per network, so it is not needed as part of the key.
pub const BuilderDepositSignatureCache = struct {

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
    builder_pubkeys: std.array_hash_map.Custom([48]u8, void, PubkeyHashContext, true) = .empty,
    hash_context: PubkeyHashContext,
    validity_context: RootContext,
    scan_cursor: usize = 0,
    capacity: usize = max_cached_deposits,

    pub fn deinit(self: *BuilderDepositSignatureCache, allocator: std.mem.Allocator) void {
        self.clear(allocator);
    }

    pub fn clear(self: *BuilderDepositSignatureCache, allocator: std.mem.Allocator) void {
        self.validity.deinit(allocator);
        self.builder_pubkeys.deinit(allocator);
        self.validity = .empty;
        self.builder_pubkeys = .empty;
        self.scan_cursor = 0;
    }

    pub fn get(self: *const BuilderDepositSignatureCache, deposit_root: [32]u8) ?bool {
        return self.validity.getContext(deposit_root, self.validity_context);
    }

    /// Only insert results from full deposit proof-of-possession verification, including
    /// public-key and signature subgroup/infinity checks. Capacity exhaustion is a cache miss.
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
        try self.validity.putContext(allocator, pending_deposit_root, valid, context);
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
