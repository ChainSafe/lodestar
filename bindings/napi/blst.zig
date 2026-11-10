//! NAPI bindings for BLS (blst) cryptographic operations used by lodestar.
//!
//! This file uses a **Zig ThreadPool** (`state.thread_pool`) — a fixed-size pool of OS threads
//! initialized once via `state.init`. Used by synchronous NAPI functions (`aggregateVerify`,
//! `verifyMultipleAggregateSignatures`) to fan out pairing checks across worker threads. The
//! call still blocks the JS thread while it waits for the pool to finish, but the crypto work
//! itself is parallelized.
const std = @import("std");
const builtin = @import("builtin");
const zapi = @import("zapi:zapi");
const js = zapi.js;
const napi = zapi.napi;
const AddonIdentity = @import("zapi_addon_identity");
const bls = @import("bls");
const bls_verifier = bls.verifier;

const NativePublicKey = bls.PublicKey;
const NativeSignature = bls.Signature;
const NativeSecretKey = bls.SecretKey;
const SigningRoot = bls.SigningRoot;
const Pairing = bls.Pairing;
const AggregatePublicKey = bls.AggregatePublicKey;
const AggregateSignature = bls.AggregateSignature;
const ThreadPool = bls.ThreadPool;
const BatchVerifyItem = bls.BatchVerifyItem;
const DST = bls.DST;
const MAX_AGGREGATE_PER_JOB = bls.MAX_AGGREGATE_PER_JOB;

/// In upstream lodestar we split batchable sets into chunks of minimum size 16.
/// Cost savings after ~16 are not significant.
/// In metrics, we can observe that sas fleet receives on average ~30 signature sets,
/// so a safe bound is about 32.
///
/// See: packages/beacon-node/src/chain/bls/multithread/worker.ts
const BATCH_VERIFY_SIZE = 32;

const SignatureSetInput = struct {
    msg: js.Uint8Array,
    pk: js.Value,
    sig: js.Value,
};

const RandomizedAggregationInput = struct {
    pk: js.Value,
    sig: js.Uint8Array,
};

/// Native-only thread pool state, reached from `root.zig` through the
/// pub `state` var so it is not part of the JS module surface.
const State = struct {
    /// Cached thread pool reference for parallel verification.
    thread_pool: ?*ThreadPool = null,

    pub fn init(self: *State, n_workers: u16) !void {
        if (self.thread_pool != null) return error.PoolExists;
        self.thread_pool = try ThreadPool.init(std.heap.page_allocator, js.io(), .{ .n_workers = n_workers });
    }

    /// Closes the `ThreadPool` used for blst operations.
    ///
    /// Note: this can invalidate any inflight verification requests. Consumer is responsible
    /// for the lifecycle of their program and should only call this when all work is done.
    ///
    /// This note is however application dependent. For the use case of lodestar,
    /// it's likely that this would not be called at all.
    /// Same goes for any other long-lived processes.
    pub fn deinit(self: *State) void {
        if (self.thread_pool) |p| {
            p.deinit(js.io());
            self.thread_pool = null;
        }
    }
};

pub var state: State = .{};

var gpa: std.heap.DebugAllocator(.{}) = .init;
const allocator = if (builtin.mode == .Debug)
    gpa.allocator()
else
    std.heap.c_allocator;

fn boolOrDefault(value: ?js.Boolean, default: bool) !bool {
    return if (value) |v| try v.toBool() else default;
}

fn hexFromString(hex_string: js.String, buf: []u8) ![]const u8 {
    const full = try hex_string.toSlice(buf);
    return if (full.len >= 2 and full[0] == '0' and full[1] == 'x') full[2..] else full;
}

fn formatHex(bytes: []const u8) !js.String {
    const hex = try std.fmt.allocPrint(allocator, "0x{x}", .{bytes});
    defer allocator.free(hex);
    return js.String.from(hex);
}

fn unwrapClass(comptime T: type, value: js.Value) !*T {
    const raw = value.toValue();
    return js.convertArg(*T, AddonIdentity, raw.value, raw.env);
}

pub const PublicKey = struct {
    pub const js_meta = js.class(.{});

    pub const COMPRESS_SIZE = NativePublicKey.COMPRESS_SIZE;
    pub const SERIALIZE_SIZE = NativePublicKey.SERIALIZE_SIZE;

    raw: NativePublicKey = .{},

    pub fn init() PublicKey {
        return .{};
    }

    /// Converts given array of bytes to a `PublicKey`.
    /// 1) bytes: Uint8Array
    /// 2) pk_validate: ?bool
    pub fn fromBytes(bytes: js.Uint8Array, pk_validate: ?js.Boolean) !PublicKey {
        const slice = try bytes.toSlice();
        var pk = try NativePublicKey.deserialize(slice);
        if (try boolOrDefault(pk_validate, false)) {
            try pk.validate();
        }
        return .{ .raw = pk };
    }

    /// Converts given hex string to a `PublicKey`.
    /// 1) bytes: string
    /// 2) pk_validate: ?bool
    pub fn fromHex(hex_string: js.String, pk_validate: ?js.Boolean) !PublicKey {
        var hex_buf: [NativePublicKey.SERIALIZE_SIZE * 2 + 2]u8 = undefined;
        const hex = try hexFromString(hex_string, &hex_buf);

        var bytes_buf: [NativePublicKey.SERIALIZE_SIZE]u8 = undefined;
        const bytes = try std.fmt.hexToBytes(&bytes_buf, hex);

        var pk = try NativePublicKey.deserialize(bytes);
        if (try boolOrDefault(pk_validate, false)) {
            try pk.validate();
        }
        return .{ .raw = pk };
    }

    /// Validates this public key.
    pub fn validate(self: *const PublicKey) !void {
        try self.raw.validate();
    }

    /// Serializes this public key to bytes.
    pub fn toBytes(self: *const PublicKey, compress: ?js.Boolean) !js.Uint8Array {
        if (try boolOrDefault(compress, true)) {
            const bytes = self.raw.compress();
            return js.Uint8Array.fromExternal(bytes[0..]);
        }
        const bytes = self.raw.serialize();
        return js.Uint8Array.fromExternal(bytes[0..]);
    }

    pub fn toHex(self: *const PublicKey, compress: ?js.Boolean) !js.String {
        if (try boolOrDefault(compress, true)) {
            const bytes = self.raw.compress();
            return formatHex(bytes[0..]);
        }
        const bytes = self.raw.serialize();
        return formatHex(bytes[0..]);
    }
};

pub const Signature = struct {
    pub const js_meta = js.class(.{});

    pub const COMPRESS_SIZE = NativeSignature.COMPRESS_SIZE;
    pub const SERIALIZE_SIZE = NativeSignature.SERIALIZE_SIZE;

    raw: NativeSignature = .{},

    pub fn init() Signature {
        return .{};
    }

    /// Converts given array of bytes to a `Signature`.
    pub fn fromBytes(bytes: js.Uint8Array, sig_validate: ?js.Boolean, sig_infcheck: ?js.Boolean) !Signature {
        const slice = try bytes.toSlice();
        var sig = NativeSignature.deserialize(slice) catch return error.DeserializationFailed;
        if (try boolOrDefault(sig_validate, false)) {
            try sig.validate(try boolOrDefault(sig_infcheck, true));
        }
        return .{ .raw = sig };
    }

    /// Converts given hex string to a `Signature`.
    ///
    /// If `sig_validate` is `true`, the signature will be infinity and group checked.
    /// If `sig_infcheck` is `false`, the infinity check will be skipped.
    pub fn fromHex(hex_string: js.String, sig_validate: ?js.Boolean, sig_infcheck: ?js.Boolean) !Signature {
        var hex_buf: [NativeSignature.SERIALIZE_SIZE * 2 + 2]u8 = undefined;
        const hex = try hexFromString(hex_string, &hex_buf);

        var bytes_buf: [NativeSignature.SERIALIZE_SIZE]u8 = undefined;
        const bytes = try std.fmt.hexToBytes(&bytes_buf, hex);

        var sig = NativeSignature.deserialize(bytes) catch return error.DeserializationFailed;
        if (try boolOrDefault(sig_validate, false)) {
            try sig.validate(try boolOrDefault(sig_infcheck, true));
        }
        return .{ .raw = sig };
    }

    /// Aggregates multiple Signature objects into one.
    /// 1) sigs_array: Signature[]
    /// 2) sigs_groupcheck: ?bool
    pub fn aggregate(signatures: js.Array, sigs_groupcheck: ?js.Boolean) !Signature {
        const signatures_len = try signatures.length();
        if (signatures_len == 0) return error.EmptySignatureArray;

        const sigs = try allocator.alloc(NativeSignature, signatures_len);
        defer allocator.free(sigs);

        for (0..signatures_len) |i| {
            const wrapped = try unwrapClass(Signature, try signatures.get(@intCast(i)));
            sigs[i] = wrapped.raw;
        }

        const agg_sig = AggregateSignature.aggregate(sigs, try boolOrDefault(sigs_groupcheck, false)) catch
            return error.AggregationFailed;

        return .{ .raw = agg_sig.toSignature() };
    }

    /// Serializes this signature to bytes.
    pub fn toBytes(self: *const Signature, compress: ?js.Boolean) !js.Uint8Array {
        if (try boolOrDefault(compress, true)) {
            const bytes = self.raw.compress();
            return js.Uint8Array.fromExternal(bytes[0..]);
        }
        const bytes = self.raw.serialize();
        return js.Uint8Array.fromExternal(bytes[0..]);
    }

    pub fn toHex(self: *const Signature, compress: ?js.Boolean) !js.String {
        if (try boolOrDefault(compress, true)) {
            const bytes = self.raw.compress();
            return formatHex(bytes[0..]);
        }
        const bytes = self.raw.serialize();
        return formatHex(bytes[0..]);
    }

    /// Validates the signature.
    /// Throws an error if the signature is invalid.
    pub fn validate(self: *const Signature, sig_infcheck: js.Boolean) !void {
        self.raw.validate(try sig_infcheck.toBool()) catch return error.InvalidSignature;
    }
};

pub const SecretKey = struct {
    pub const js_meta = js.class(.{});

    raw: NativeSecretKey = .{},

    pub fn init() SecretKey {
        return .{};
    }

    /// Creates a `SecretKey` from raw bytes.
    pub fn fromBytes(bytes: js.Uint8Array) !SecretKey {
        const slice = try bytes.toSlice();
        if (slice.len != NativeSecretKey.serialize_size) {
            return error.InvalidSecretKeyLength;
        }
        const sk = NativeSecretKey.deserialize(slice[0..NativeSecretKey.serialize_size]) catch
            return error.DeserializationFailed;
        return .{ .raw = sk };
    }

    /// Creates a `SecretKey` from a hex string.
    pub fn fromHex(hex_string: js.String) !SecretKey {
        switch (try hex_string.len()) {
            NativeSecretKey.serialize_size * 2,
            NativeSecretKey.serialize_size * 2 + 2,
            => {},
            else => return error.InvalidSecretKeyLength,
        }

        var hex_buf: [NativeSecretKey.serialize_size * 2 + 3]u8 = undefined;
        const hex = try hexFromString(hex_string, &hex_buf);
        if (hex.len != NativeSecretKey.serialize_size * 2) {
            return error.InvalidSecretKeyLength;
        }

        var bytes_buf: [NativeSecretKey.serialize_size]u8 = undefined;
        const bytes = try std.fmt.hexToBytes(&bytes_buf, hex);
        const sk = NativeSecretKey.deserialize(bytes[0..NativeSecretKey.serialize_size]) catch
            return error.DeserializationFailed;
        return .{ .raw = sk };
    }

    /// Generates a `SecretKey` from a seed (IKM) using key derivation.
    /// Seed must be at least 32 bytes.
    pub fn fromKeygen(seed: js.Uint8Array, key_info: ?js.Value) !SecretKey {
        const seed_slice = try seed.toSlice();
        if (seed_slice.len < 32) return error.InvalidSeedLength;

        const key_info_slice: ?[]const u8 = if (key_info) |value| blk: {
            if (value.isUndefined() or value.isNull()) break :blk null;
            break :blk try (try value.asUint8Array()).toSlice();
        } else null;

        const sk = NativeSecretKey.keyGen(seed_slice, key_info_slice) catch return error.KeyGenFailed;
        return .{ .raw = sk };
    }

    /// Signs a message with this `SecretKey`, returns a `Signature`.
    pub fn sign(self: *const SecretKey, msg: js.Uint8Array) !Signature {
        const msg_bytes = try msg.toSlice();
        if (msg_bytes.len != @sizeOf(SigningRoot)) return error.InvalidMessageLength;
        return .{ .raw = self.raw.sign(msg_bytes[0..@sizeOf(SigningRoot)], DST, null) };
    }

    /// Derives the PublicKey from this SecretKey.
    pub fn toPublicKey(self: *const SecretKey) !PublicKey {
        return .{ .raw = self.raw.toPublicKey() };
    }

    /// Serializes the SecretKey to bytes (32 bytes).
    pub fn toBytes(self: *const SecretKey) !js.Uint8Array {
        const bytes = self.raw.serialize();
        return js.Uint8Array.fromExternal(bytes[0..]);
    }

    pub fn toHex(self: *const SecretKey) !js.String {
        const bytes = self.raw.serialize();
        return formatHex(bytes[0..]);
    }
};
/// Verifies a given `msg` against a `Signature` and a `PublicKey`.
///
/// Returns `true` if signature is valid, `false` otherwise.
///
/// Arguments:
/// 1) msg: Uint8Array
/// 2) pk: PublicKey
/// 3) sig: Signature
/// 4) pk_validate: ?bool
/// 5) sig_groupcheck: ?bool
pub fn verify(msg: js.Uint8Array, pk: PublicKey, sig: Signature, pk_validate: ?js.Boolean, sig_groupcheck: ?js.Boolean) !js.Boolean {
    const msg_bytes = try msg.toSlice();
    if (msg_bytes.len != @sizeOf(SigningRoot)) return error.InvalidMessageLength;

    sig.raw.verify(
        try boolOrDefault(sig_groupcheck, false),
        msg_bytes[0..@sizeOf(SigningRoot)],
        DST,
        null,
        &pk.raw,
        try boolOrDefault(pk_validate, false),
    ) catch return js.Boolean.from(false);

    return js.Boolean.from(true);
}

/// Verify an aggregated signature against multiple messages and multiple public keys.
/// 1) msgs: Uint8Array[]
/// 2) pks: PublicKey[]
/// 3) sig: Signature
/// 4) pks_validate: ?bool
/// 5) sig_groupcheck: ?bool
pub fn aggregateVerify(msgs: js.Array, pks: js.Array, sig: Signature, pks_validate: ?js.Boolean, sig_groupcheck: ?js.Boolean) !js.Boolean {
    const msgs_len = try msgs.length();
    const pks_len = try pks.length();
    if (msgs_len == 0 or pks_len == 0 or msgs_len != pks_len) {
        return error.InvalidAggregateVerifyInput;
    }

    const msg_bufs = try allocator.alloc(SigningRoot, msgs_len);
    defer allocator.free(msg_bufs);

    const pk_ptrs = try allocator.alloc(*NativePublicKey, pks_len);
    defer allocator.free(pk_ptrs);

    for (0..msgs_len) |i| {
        const msg_value = try msgs.get(@intCast(i));
        const msg_bytes = try (try msg_value.asUint8Array()).toSlice();
        if (msg_bytes.len != @sizeOf(SigningRoot)) return error.InvalidMessageLength;
        msg_bufs[i] = msg_bytes[0..@sizeOf(SigningRoot)].*;

        const wrapped_pk = try unwrapClass(PublicKey, try pks.get(@intCast(i)));
        pk_ptrs[i] = &wrapped_pk.raw;
    }

    const pool = state.thread_pool orelse return error.ThreadPoolNotInitialized;
    const result = pool.aggregateVerify(
        js.io(),
        &sig.raw,
        try boolOrDefault(sig_groupcheck, false),
        msg_bufs,
        DST,
        pk_ptrs,
        try boolOrDefault(pks_validate, false),
    ) catch return js.Boolean.from(false);

    return js.Boolean.from(result);
}

/// Aggregate and verify an array of `PublicKey`s. Returns `false` if pks array is empty
/// or if signature is invalid.
///
/// `msg` (signing root) must be exactly 32 bytes.
///
/// Arguments:
/// 1) msg: Uint8Array
/// 2) pks: PublicKey[]
/// 3) sig: Signature
/// 4) sigs_groupcheck: ?bool
pub fn fastAggregateVerify(msg: js.Uint8Array, pks: js.Array, sig: Signature, sigs_groupcheck: ?js.Boolean) !js.Boolean {
    const msg_bytes = try msg.toSlice();
    if (msg_bytes.len != @sizeOf(SigningRoot)) return error.InvalidMessageLength;

    const pks_len = try pks.length();
    if (pks_len == 0) return js.Boolean.from(false);

    const native_pks = try allocator.alloc(NativePublicKey, pks_len);
    defer allocator.free(native_pks);

    for (0..pks_len) |i| {
        const wrapped_pk = try unwrapClass(PublicKey, try pks.get(@intCast(i)));
        native_pks[i] = wrapped_pk.raw;
    }

    var pairing_buf: [Pairing.sizeOf()]u8 align(Pairing.buf_align) = undefined;
    // `pks_validate` is always false here since we assume proof of possession for public keys.
    const result = sig.raw.fastAggregateVerify(
        try boolOrDefault(sigs_groupcheck, false),
        &pairing_buf,
        msg_bytes[0..@sizeOf(SigningRoot)],
        DST,
        native_pks,
        false,
    ) catch return js.Boolean.from(false);

    return js.Boolean.from(result);
}

/// Batch verify multiple signature sets.
/// Returns `false` if verification fails.
///
/// Arguments:
/// 1) sets: Array of { msg: Uint8Array, pk: PublicKey, sig: Signature }
/// 2) pks_validate: ?bool
/// 3) sigs_groupcheck: ?bool
pub fn verifyMultipleAggregateSignatures(sets: js.Array, pks_validate: ?js.Boolean, sigs_groupcheck: ?js.Boolean) !js.Boolean {
    const n_elems = try sets.length();
    if (n_elems == 0) return js.Boolean.from(false);

    var items_stack: [BATCH_VERIFY_SIZE]BatchVerifyItem = undefined;
    var items_heap: ?[]BatchVerifyItem = null;
    defer if (items_heap) |buf| allocator.free(buf);

    const items = if (n_elems <= BATCH_VERIFY_SIZE) items_stack[0..n_elems] else blk: {
        const buf = try allocator.alloc(BatchVerifyItem, n_elems);
        items_heap = buf;
        break :blk buf;
    };

    for (0..n_elems) |i| {
        const set_value = try sets.get(@intCast(i));
        const set = try (try set_value.asObject(SignatureSetInput)).get();
        const message_bytes = try set.msg.toSlice();
        if (message_bytes.len != @sizeOf(SigningRoot)) return error.InvalidMessageLength;
        const public_key = try unwrapClass(PublicKey, set.pk);
        const signature = try unwrapClass(Signature, set.sig);
        items[i] = .{
            .message = message_bytes[0..@sizeOf(SigningRoot)],
            .public_key = &public_key.raw,
            .signature = &signature.raw,
            .randomness = undefined,
        };
    }

    const pool = state.thread_pool orelse return error.ThreadPoolNotInitialized;
    const result = try bls_verifier.verifySignatureSets(
        js.io(),
        pool,
        items,
        .{
            .pks_validate = try boolOrDefault(pks_validate, false),
            .sigs_groupcheck = try boolOrDefault(sigs_groupcheck, false),
        },
    );

    return js.Boolean.from(result);
}

/// Aggregate multiple Signature objects into one.
/// Validates each signature if `sigs_groupcheck` is true.
///
/// Arguments:
/// 1) signatures: Signature[]
/// 2) sigs_groupcheck: ?bool
pub fn aggregateSignatures(signatures: js.Array, sigs_groupcheck: ?js.Boolean) !Signature {
    const signatures_len = try signatures.length();
    if (signatures_len == 0) return error.EmptySignatureArray;

    const sigs = try allocator.alloc(NativeSignature, signatures_len);
    defer allocator.free(sigs);

    for (0..signatures_len) |i| {
        const wrapped = try unwrapClass(Signature, try signatures.get(@intCast(i)));
        sigs[i] = wrapped.raw;
    }

    const agg_sig = AggregateSignature.aggregate(sigs, try boolOrDefault(sigs_groupcheck, false)) catch
        return error.AggregationFailed;

    return .{ .raw = agg_sig.toSignature() };
}

/// Aggregate multiple `PublicKey` objects into one.
///
/// Arguments:
/// 1) pks: PublicKey[]
/// 2) pks_validate: ?bool
pub fn aggregatePublicKeys(pks: js.Array, pks_validate: ?js.Boolean) !PublicKey {
    const pks_len = try pks.length();
    if (pks_len == 0) return error.EmptyPublicKeyArray;

    const native_pks = try allocator.alloc(NativePublicKey, pks_len);
    defer allocator.free(native_pks);

    for (0..pks_len) |i| {
        const wrapped = try unwrapClass(PublicKey, try pks.get(@intCast(i)));
        native_pks[i] = wrapped.raw;
    }

    const agg_pk = AggregatePublicKey.aggregate(native_pks, try boolOrDefault(pks_validate, false)) catch
        return error.AggregationFailed;

    return .{ .raw = agg_pk.toPublicKey() };
}

/// Aggregate public keys from serialized bytes.
///
/// Arguments:
/// 1) serializedPublicKeys: Uint8Array[] - array of serialized (96-bytes each) `PublicKey`s.
/// 2) pks_validate: ?bool
pub fn aggregateSerializedPublicKeys(serialized_public_keys: js.Array, pks_validate: ?js.Boolean) !PublicKey {
    const pks_len = try serialized_public_keys.length();
    if (pks_len == 0) return error.EmptyPublicKeyArray;

    const native_pks = try allocator.alloc(NativePublicKey, pks_len);
    defer allocator.free(native_pks);

    for (0..pks_len) |i| {
        const value = try serialized_public_keys.get(@intCast(i));
        const bytes = try (try value.asUint8Array()).toSlice();
        native_pks[i] = NativePublicKey.deserialize(bytes) catch return error.DeserializationFailed;
    }

    const agg_pk = AggregatePublicKey.aggregate(native_pks, try boolOrDefault(pks_validate, false)) catch
        return error.AggregationFailed;

    return .{ .raw = agg_pk.toPublicKey() };
}

/// Build a JS `Error` with `.code = code` and `.message = "<where>: <code>"`
/// and reject `deferred` with it. JS callers see a real `Error` instance, not
/// a bare string, so they can branch on `err.code` cleanly.
fn rejectWithError(env: napi.Env, deferred: napi.Deferred, where: []const u8, code: []const u8) !void {
    var msg_buf: [256]u8 = undefined;
    const msg = std.fmt.bufPrint(&msg_buf, "{s}: {s}", .{ where, code }) catch code;

    const code_val = try env.createStringUtf8(code);
    const msg_val = try env.createStringUtf8(msg);
    const err_val = try env.createError(code_val, msg_val);
    try deferred.reject(err_val);
}
