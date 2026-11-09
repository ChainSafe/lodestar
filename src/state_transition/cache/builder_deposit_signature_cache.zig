const std = @import("std");
const ct = @import("consensus_types");
const BeaconConfig = @import("config").BeaconConfig;
const preset = @import("preset").preset;
const RefCount = @import("../utils/ref_count.zig").RefCount;
const PubkeyHashContext = @import("pubkey_cache.zig").PubkeyHashContext;

pub const max_deposits_per_call = 10_000;
pub const max_cached_deposits = 2 * preset.SLOTS_PER_EPOCH * max_deposits_per_call;
pub const BuilderDepositSignatureCacheRc = RefCount(BuilderDepositSignatureCache);

/// Signature results are independent of queue order and shared across state clones and reloads.
/// Access must stay on the owning state thread. Keys include every signed field, the signature,
/// and the deposit domain's fork version; neither recycled node IDs nor deposit indexes are keys.
pub const BuilderDepositSignatureCache = struct {
    const Key = struct {
        deposit_root: [32]u8,
        genesis_fork_version: [4]u8,
    };

    const KeyContext = struct {
        pubkey_context: PubkeyHashContext,

        pub fn hash(self: KeyContext, value: Key) u32 {
            return @truncate(std.hash.SipHash64(1, 3).toInt(
                &(value.deposit_root ++ value.genesis_fork_version),
                &self.pubkey_context.hash_key,
            ));
        }

        pub fn eql(_: KeyContext, lhs: Key, rhs: Key, _: usize) bool {
            return std.mem.eql(
                u8,
                &lhs.deposit_root,
                &rhs.deposit_root,
            ) and std.mem.eql(
                u8,
                &lhs.genesis_fork_version,
                &rhs.genesis_fork_version,
            );
        }
    };

    validity: std.array_hash_map.Custom(Key, bool, KeyContext, true) = .empty,
    builder_pubkeys: std.array_hash_map.Custom([48]u8, void, PubkeyHashContext, true) = .empty,
    hash_context: PubkeyHashContext,
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

    fn key(config: *const BeaconConfig, deposit: *const ct.electra.PendingDeposit.Type) !Key {
        var result: Key = .{ .deposit_root = undefined, .genesis_fork_version = config.chain.GENESIS_FORK_VERSION };
        try ct.phase0.DepositData.hashTreeRoot(&.{
            .pubkey = deposit.pubkey,
            .withdrawal_credentials = deposit.withdrawal_credentials,
            .amount = deposit.amount,
            .signature = deposit.signature,
        }, &result.deposit_root);
        return result;
    }

    pub fn get(
        self: *const BuilderDepositSignatureCache,
        config: *const BeaconConfig,
        deposit: *const ct.electra.PendingDeposit.Type,
    ) !?bool {
        return self.validity.getContext(try key(config, deposit), .{ .pubkey_context = self.hash_context });
    }

    /// Only insert results from full deposit proof-of-possession verification, including
    /// public-key and signature subgroup/infinity checks. Capacity exhaustion is a cache miss.
    pub fn put(
        self: *BuilderDepositSignatureCache,
        allocator: std.mem.Allocator,
        config: *const BeaconConfig,
        deposit: *const ct.electra.PendingDeposit.Type,
        valid: bool,
    ) !void {
        const deposit_key = try key(config, deposit);
        const context: KeyContext = .{ .pubkey_context = self.hash_context };
        if (self.validity.getPtrContext(deposit_key, context)) |value| {
            std.debug.assert(value.* == valid);
            return;
        }
        if (self.validity.count() >= self.capacity) return;
        try self.validity.putContext(allocator, deposit_key, valid, context);
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
