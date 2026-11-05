//! Lock-protected, append-only cache for validator BLS public keys.
//!
//! The cache maps each validator index to a compressed public key and its
//! uncompressed affine form. It provides:
//! 1. Lookup by validator index or compressed public key.
//! 2. Aggregation by validator index.
//! 3. Bulk synchronization from a validator list.
//!
//! # Safety
//!
//! Decoding rejects malformed compressed encodings and off-curve points. It
//! does not reject cryptographically invalid keys.
//!
//! Before cache insertion, each population path must establish these properties:
//!
//! 1. An append caller must reject cryptographically invalid keys.
//! 2. Bulk synchronization must use state whose validator additions passed
//!    deposit proof-of-possession validation.
//! 3. Snapshot installation must use a file produced from such a cache and
//!    protected from untrusted modification.

const std = @import("std");
const bls = @import("bls");
const types = @import("consensus_types");
const Validator = types.phase0.Validator.Type;

const HashKey = [std.hash.SipHash64(1, 3).key_length]u8;
pub const uncompress_batch_size = 1000;

fn uncompressBatch(
    validators: []const *const Validator,
    prepared: []bls.PublicKey,
    batch_error: *?bls.BlstError,
) void {
    std.debug.assert(validators.len == prepared.len);
    std.debug.assert(validators.len <= uncompress_batch_size);

    for (validators, prepared) |validator, *affine| {
        affine.* = bls.PublicKey.uncompress(&validator.pubkey) catch |err| {
            batch_error.* = err;
            return;
        };
    }
}

/// Keyed hashing prevents an untrusted set of compressed pubkeys from forcing
/// pathological probe chains in the reverse lookup.
pub const PubkeyHashContext = struct {
    hash_key: HashKey,

    pub fn hash(self: PubkeyHashContext, pubkey: [48]u8) u32 {
        return @truncate(std.hash.SipHash64(1, 3).toInt(&pubkey, &self.hash_key));
    }

    pub fn eql(
        _: PubkeyHashContext,
        lhs: [48]u8,
        rhs: [48]u8,
        _: usize,
    ) bool {
        return std.mem.eql(u8, &lhs, &rhs);
    }
};

/// The dense entry index is the validator index. Production code only appends,
/// so insertion order permanently supplies both lookup directions:
/// compressed pubkey -> validator index and validator index -> affine pubkey.
pub const PubkeyMap = std.array_hash_map.Custom(
    [48]u8,
    bls.PublicKey,
    PubkeyHashContext,
    true,
);

// Bound capacity by both the map's u32 index space and the largest dense
// allocation that can grow without overflowing usize.
const dense_capacity_limit =
    std.math.maxInt(usize) / PubkeyMap.DataList.capacityInBytes(1);
pub const max_capacity: usize = @min(
    @as(usize, std.math.maxInt(u32)),
    dense_capacity_limit / 2,
);

/// Append-only pubkey cache.
///
/// ArrayHashMap storage may move when it grows, so every access is protected by
/// the cache-owned read/write lock. Readers copy values out before releasing
/// the shared lock; no pointer into the map escapes. Production mutations only
/// append (and occasionally grow). `clear` exists for tests/API compatibility
/// and retains all allocated capacity.
pub const PubkeyCache = struct {
    allocator: std.mem.Allocator,
    entries: PubkeyMap,
    hash_key: HashKey,
    /// Guards movable map storage and serializes cache allocator use.
    lock: std.Io.RwLock,

    pub fn init(allocator: std.mem.Allocator, io: std.Io) PubkeyCache {
        var hash_key: HashKey = undefined;
        io.random(&hash_key);
        return .{
            .allocator = allocator,
            .entries = .empty,
            .hash_key = hash_key,
            .lock = .init,
        };
    }

    pub fn initCapacity(
        allocator: std.mem.Allocator,
        io: std.Io,
        initial_capacity: usize,
    ) !PubkeyCache {
        try validateCapacity(initial_capacity);

        var self = init(allocator, io);
        errdefer self.deinit();
        try self.ensureTotalCapacityExactUnlocked(initial_capacity);
        return self;
    }

    /// The owner must exclude concurrent users before destroying the cache.
    pub fn deinit(self: *PubkeyCache) void {
        self.entries.deinit(self.allocator);
        self.* = undefined;
    }

    pub fn hashContext(self: *const PubkeyCache) PubkeyHashContext {
        return .{ .hash_key = self.hash_key };
    }

    /// Reserve exactly `new_capacity` entries when growing dense storage.
    /// Existing larger capacity is retained.
    pub fn ensureTotalCapacity(
        self: *PubkeyCache,
        io: std.Io,
        new_capacity: usize,
    ) !void {
        try validateCapacity(new_capacity);
        try self.lock.lock(io);
        defer self.lock.unlock(io);

        try self.ensureTotalCapacityExactUnlocked(new_capacity);
    }

    /// Test/reset API. Production operation is append-only and does not call
    /// this method. Capacity is retained to avoid turning reset into a resize.
    pub fn clear(self: *PubkeyCache, io: std.Io) !void {
        try self.lock.lock(io);
        defer self.lock.unlock(io);
        self.entries.clearRetainingCapacity();
    }

    pub fn count(self: *const PubkeyCache, io: std.Io) u32 {
        self.lockShared(io);
        defer self.unlockShared(io);
        return @intCast(self.entries.count());
    }

    pub fn capacity(self: *const PubkeyCache, io: std.Io) usize {
        self.lockShared(io);
        defer self.unlockShared(io);
        return self.entries.capacity();
    }

    /// Get the validator index for a compressed pubkey, if cached.
    pub fn get(self: *const PubkeyCache, io: std.Io, pubkey: [48]u8) ?u64 {
        self.lockShared(io);
        defer self.unlockShared(io);
        const index = self.entries.getIndexContext(pubkey, self.hashContext()) orelse
            return null;
        return @intCast(index);
    }

    /// Get the affine pubkey for a validator index. A value is returned so no
    /// pointer into movable map storage escapes the shared lock.
    pub fn getPubkey(
        self: *const PubkeyCache,
        io: std.Io,
        index: u64,
    ) ?bls.PublicKey {
        self.lockShared(io);
        defer self.unlockShared(io);
        if (index >= self.entries.count()) return null;
        return self.entries.values()[@intCast(index)];
    }

    /// Get the compressed pubkey bytes for a validator index. A value is
    /// returned so no pointer into movable map storage escapes the shared
    /// lock.
    pub fn getPubkeyBytes(
        self: *const PubkeyCache,
        io: std.Io,
        index: u64,
    ) ?[48]u8 {
        self.lockShared(io);
        defer self.unlockShared(io);
        if (index >= self.entries.count()) return null;
        return self.entries.keys()[@intCast(index)];
    }

    /// Copy affine pubkeys for a batch of validator indices while holding one
    /// shared lock. The output is left unchanged when an index is invalid.
    pub fn getPubkeys(
        self: *const PubkeyCache,
        io: std.Io,
        indices: []const u64,
        out: []bls.PublicKey,
    ) !void {
        if (indices.len != out.len) return error.InvalidLength;

        self.lockShared(io);
        defer self.unlockShared(io);

        const values = self.entries.values();
        for (indices) |index| {
            if (index >= values.len) return error.InvalidIndex;
        }
        for (indices, out) |index, *pubkey| {
            pubkey.* = values[@intCast(index)];
        }
    }

    /// Resolve a batch of compressed pubkeys to validator indices while
    /// holding one shared lock.
    pub fn getValidatorIndices(
        self: *const PubkeyCache,
        io: std.Io,
        pubkeys: []const [48]u8,
        out: []u64,
    ) !void {
        if (pubkeys.len != out.len) return error.InvalidLength;

        self.lockShared(io);
        defer self.unlockShared(io);

        const context = self.hashContext();
        for (pubkeys, out) |pubkey, *index| {
            index.* = @intCast(self.entries.getIndexContext(pubkey, context) orelse
                return error.PubkeyNotFound);
        }
    }

    /// Aggregate the pubkeys at the requested validator indices.
    pub fn aggregate(
        self: *const PubkeyCache,
        io: std.Io,
        indices: []const u64,
    ) !bls.PublicKey {
        return self.aggregateIndices(io, u64, indices);
    }

    /// Aggregate the pubkeys at indices of the requested integer type.
    pub fn aggregateIndices(
        self: *const PubkeyCache,
        io: std.Io,
        comptime Index: type,
        indices: []const Index,
    ) !bls.PublicKey {
        if (indices.len == 0) return error.InvalidLength;

        self.lockShared(io);
        defer self.unlockShared(io);

        const values = self.entries.values();
        if (indices[0] >= values.len) return error.InvalidIndex;
        var aggregate_pubkey = values[@intCast(indices[0])].toAggregate();
        for (indices[1..]) |index| {
            if (index >= values.len) return error.InvalidIndex;
            aggregate_pubkey.add(&values[@intCast(index)]);
        }
        return aggregate_pubkey.toPublicKey();
    }

    /// Append a compressed pubkey at the next validator index. Supplying an
    /// already-cached index is an idempotent consistency check.
    pub fn append(
        self: *PubkeyCache,
        io: std.Io,
        pubkey: [48]u8,
        index: u64,
    ) !void {
        const affine = try bls.PublicKey.uncompress(&pubkey);

        try self.lock.lock(io);
        defer self.lock.unlock(io);

        const current_len = self.entries.count();
        if (index < current_len) {
            if (!std.mem.eql(
                u8,
                &self.entries.keys()[@intCast(index)],
                &pubkey,
            )) return error.ConflictingPubkey;
            return;
        }
        if (index > current_len) return error.InvalidIndexToAppend;
        if (self.entries.getIndexContext(pubkey, self.hashContext()) != null) {
            return error.DuplicatePubkey;
        }

        try validateCapacity(current_len + 1);
        try self.ensureTotalCapacityAmortizedUnlocked(current_len + 1);
        self.entries.putAssumeCapacityNoClobberContext(
            pubkey,
            affine,
            self.hashContext(),
        );
    }

    /// Populate the cache from the missing suffix of a validator list. Existing
    /// entries are trusted as the application's unforkable singleton history.
    pub fn syncPubkeys(
        self: *PubkeyCache,
        io: std.Io,
        validators: []const *const Validator,
    ) !void {
        try validateCapacity(validators.len);

        self.lockShared(io);
        const already_synced = validators.len <= self.entries.count();
        self.unlockShared(io);
        if (already_synced) return;

        try self.lock.lock(io);
        defer self.lock.unlock(io);

        const old_len = self.entries.count();
        if (validators.len <= old_len) return;

        const suffix = validators[old_len..];
        const prepared = try self.allocator.alloc(bls.PublicKey, suffix.len);
        defer self.allocator.free(prepared);

        const batch_count = (suffix.len - 1) / uncompress_batch_size + 1;
        const batch_errors = try self.allocator.alloc(?bls.BlstError, batch_count);
        defer self.allocator.free(batch_errors);
        @memset(batch_errors, null);

        var group: std.Io.Group = .init;
        errdefer group.cancel(io);
        // `async` bounds worker growth and runs excess batches on the caller.
        for (batch_errors, 0..) |*batch_error, batch_index| {
            const batch_start = batch_index * uncompress_batch_size;
            const batch_end = @min(batch_start + uncompress_batch_size, suffix.len);
            group.async(io, uncompressBatch, .{
                suffix[batch_start..batch_end],
                prepared[batch_start..batch_end],
                batch_error,
            });
        }
        try group.await(io);

        for (batch_errors) |batch_error| {
            if (batch_error) |err| return err;
        }

        try self.ensureTotalCapacityAmortizedUnlocked(validators.len);

        const context = self.hashContext();
        for (suffix, prepared) |validator, affine| {
            const result = self.entries.getOrPutAssumeCapacityContext(
                validator.pubkey,
                context,
            );
            if (result.found_existing) {
                self.entries.shrinkRetainingCapacityContext(old_len, context);
                return error.DuplicatePubkey;
            }
            result.value_ptr.* = affine;
        }
    }

    fn validateCapacity(requested_capacity: usize) !void {
        if (requested_capacity > max_capacity) return error.CapacityOverflow;
    }

    fn ensureTotalCapacityAmortizedUnlocked(
        self: *PubkeyCache,
        new_capacity: usize,
    ) !void {
        try self.entries.ensureTotalCapacityContext(
            self.allocator,
            new_capacity,
            self.hashContext(),
        );
    }

    fn ensureTotalCapacityExactUnlocked(
        self: *PubkeyCache,
        new_capacity: usize,
    ) !void {
        if (new_capacity <= self.entries.capacity()) return;
        if (new_capacity > self.entries.entries.capacity) {
            try self.entries.entries.setCapacity(self.allocator, new_capacity);
        }
        try self.entries.ensureTotalCapacityContext(
            self.allocator,
            new_capacity,
            self.hashContext(),
        );
    }

    fn lockShared(self: *const PubkeyCache, io: std.Io) void {
        @constCast(&self.lock).lockSharedUncancelable(io);
    }

    fn unlockShared(self: *const PubkeyCache, io: std.Io) void {
        @constCast(&self.lock).unlockShared(io);
    }
};

test {
    _ = @import("pubkey_cache_test.zig");
}
