//! NAPI bindings for leanXMSS signatures and their aggregation into leanVM proofs.
//!
//! Everything slower than a signature check runs on the libuv pool. Key
//! generation, signing and aggregation fan out from there over leanVM's own
//! thread pool, which outlives the addon.
//!
//! Claims and signed claims cross the boundary packed: `CLAIM_SIZE` bytes of
//! public key then message, and `SIGNED_SIZE` bytes of the same then signature.
const std = @import("std");
const zapi = @import("zapi:zapi");
const js = zapi.js;
const napi = zapi.napi;
const AddonIdentity = @import("zapi_addon_identity");
const leanvm = @import("leanvm");
const xmss = leanvm.xmss;

pub const SEED_SIZE: u32 = xmss.seed_len;
pub const MESSAGE_SIZE: u32 = xmss.message_len;
pub const PUBLIC_KEY_SIZE: u32 = xmss.public_key_size;
pub const SIGNATURE_SIZE: u32 = xmss.signature_size;
pub const CLAIM_SIZE: u32 = @sizeOf(xmss.Claim);
pub const SIGNED_SIZE: u32 = @sizeOf(xmss.Signed);
pub const MAX_RECURSIONS: u32 = leanvm.max_recursions;
pub const MAX_KEYS: u32 = leanvm.max_keys;
pub const MIN_LOG_INV_RATE: u32 = leanvm.min_log_inv_rate;
pub const MAX_LOG_INV_RATE: u32 = leanvm.max_log_inv_rate;

/// False where the build has no leanVM library or the CPU lacks an instruction
/// set extension the library was built for. Every other function then fails.
pub fn isAvailable() js.Boolean {
    return js.Boolean.from(leanvm.cpuSupported());
}

/// Guards every entry: on an unsupported CPU the library may execute an
/// illegal instruction.
fn ensureAvailable() !void {
    if (!leanvm.cpuSupported()) return error.LeanvmUnavailable;
}

fn fixed(comptime len: usize, bytes: js.Uint8Array, comptime err: anyerror) ![len]u8 {
    const slice = try bytes.toSlice();
    if (slice.len != len) return err;
    return slice[0..len].*;
}

/// A whole number of `T`, copied out of the JS heap for a worker thread.
fn dupePacked(comptime T: type, allocator: std.mem.Allocator, bytes: js.Uint8Array, comptime err: anyerror) ![]T {
    const slice = try bytes.toSlice();
    if (slice.len % @sizeOf(T) != 0) return err;
    const copy = try allocator.alloc(T, slice.len / @sizeOf(T));
    @memcpy(std.mem.sliceAsBytes(copy), slice);
    return copy;
}

/// A native key shared by its JS object and the tasks using it, so that
/// collecting the object never frees a key a worker thread is signing with.
/// Counted on the JS thread only.
const SharedKey = struct {
    key: *xmss.SecretKey,
    refs: usize = 1,

    fn retain(self: *SharedKey) void {
        self.refs += 1;
    }

    fn release(self: *SharedKey) void {
        self.refs -= 1;
        if (self.refs != 0) return;
        self.key.deinit();
        js.allocator().destroy(self);
    }
};

const KeyTask = struct {
    /// Null generates a key from the operating system's randomness.
    seed: ?xmss.Seed,
    key: ?*xmss.SecretKey = null,

    pub fn compute(self: *KeyTask) !void {
        self.key = if (self.seed) |*seed| try xmss.SecretKey.fromSeed(seed) else try xmss.SecretKey.generate();
    }

    pub fn resolve(self: *KeyTask, env: napi.Env) !napi.Value {
        const shared = try js.allocator().create(SharedKey);
        shared.* = .{ .key = self.key.? };
        self.key = null;
        // The instance owns `shared` from here, a failed materialization included.
        const instance = js.convertReturn(XmssSecretKey, AddonIdentity, .{ .shared = shared }, env.env);
        if (instance == null) return error.MaterializeFailed;
        return .{ .env = env.env, .value = instance };
    }

    pub fn deinit(self: *KeyTask) void {
        if (self.seed) |*seed| std.crypto.secureZero(u8, seed);
        if (self.key) |key| key.deinit();
    }
};

const PrepareTask = struct {
    shared: *SharedKey,
    leaf_index: xmss.LeafIndex,

    pub fn compute(self: *PrepareTask) !void {
        try self.shared.key.prepare(self.leaf_index);
    }

    pub fn resolve(_: *PrepareTask, _: napi.Env) void {}

    pub fn deinit(self: *PrepareTask) void {
        self.shared.release();
    }
};

const SignTask = struct {
    shared: *SharedKey,
    message: xmss.Message,
    leaf_index: xmss.LeafIndex,
    signature: xmss.Signature = undefined,

    pub fn compute(self: *SignTask) !void {
        self.signature = try self.shared.key.sign(&self.message, self.leaf_index);
    }

    pub fn resolve(self: *SignTask, _: napi.Env) !js.OwnedUint8Array {
        return .fromSlice(js.allocator(), &self.signature);
    }

    pub fn deinit(self: *SignTask) void {
        self.shared.release();
    }
};

/// A leanXMSS secret key. Instances come from `generate` and `fromSeed`: one
/// built with `new` holds no key and every method throws `KeyNotLoaded`.
pub const XmssSecretKey = struct {
    pub const js_meta = js.class(.{});

    shared: ?*SharedKey = null,

    pub fn init() XmssSecretKey {
        return .{};
    }

    pub fn deinit(self: *XmssSecretKey) void {
        if (self.shared) |shared| shared.release();
        self.shared = null;
    }

    /// Resolves with a fresh key, its seed from the operating system's randomness.
    pub fn generate() !js.Value {
        try ensureAvailable();
        return js.spawn(KeyTask, .{ .seed = null }, "leanvm.XmssSecretKey.generate");
    }

    /// Resolves with the key of `seed`, which is all of its secret material.
    pub fn fromSeed(seed: js.Uint8Array) !js.Value {
        try ensureAvailable();
        var task: KeyTask = .{ .seed = try fixed(xmss.seed_len, seed, error.InvalidSeedLength) };
        // Wipes this copy of the seed: the spawned task holds its own.
        defer task.deinit();
        return js.spawn(KeyTask, task, "leanvm.XmssSecretKey.fromSeed");
    }

    /// SECRET KEY MATERIAL.
    pub fn toSeed(self: *const XmssSecretKey) !js.Uint8Array {
        const shared = self.shared orelse return error.KeyNotLoaded;
        return js.Uint8Array.from(&try shared.key.seed());
    }

    pub fn toPublicKey(self: *const XmssSecretKey) !js.Uint8Array {
        const shared = self.shared orelse return error.KeyNotLoaded;
        return js.Uint8Array.from(&try shared.key.publicKey());
    }

    /// Builds the bottom tree `leaf_index` is in, ahead of `sign`.
    pub fn prepare(self: *const XmssSecretKey, leaf_index: js.Number) !js.Value {
        const shared = self.shared orelse return error.KeyNotLoaded;
        const task: PrepareTask = .{ .shared = shared, .leaf_index = try leaf_index.toU32Exact() };
        shared.retain();
        errdefer shared.release();
        return js.spawn(PrepareTask, task, "leanvm.XmssSecretKey.prepare");
    }

    /// Resolves with the signature of `message` at `leaf_index`. NEVER sign two
    /// different messages with the same key and leaf index.
    pub fn sign(self: *const XmssSecretKey, message: js.Uint8Array, leaf_index: js.Number) !js.Value {
        const shared = self.shared orelse return error.KeyNotLoaded;
        const task: SignTask = .{
            .shared = shared,
            .message = try fixed(xmss.message_len, message, error.InvalidMessageLength),
            .leaf_index = try leaf_index.toU32Exact(),
        };
        shared.retain();
        errdefer shared.release();
        return js.spawn(SignTask, task, "leanvm.XmssSecretKey.sign");
    }
};

const SetupTask = struct {
    pub fn compute(_: *SetupTask) !void {
        try leanvm.setup();
    }

    pub fn resolve(_: *SetupTask, _: napi.Env) void {}

    pub fn deinit(_: *SetupTask) void {}
};

/// Compiles the aggregation guest ahead of the first `aggregate` or
/// `verifyAggregate`, which otherwise pays for it.
pub fn setup() !js.Value {
    try ensureAvailable();
    return js.spawn(SetupTask, .{}, "leanvm.setup");
}

/// Whether `signature` is `public_key`'s on `message`. Throws on a wrong length.
pub fn verify(public_key: js.Uint8Array, message: js.Uint8Array, signature: js.Uint8Array) !js.Boolean {
    try ensureAvailable();
    const key = try fixed(xmss.public_key_size, public_key, error.InvalidPublicKeyLength);
    const signed = try fixed(xmss.message_len, message, error.InvalidMessageLength);
    const bytes = try fixed(xmss.signature_size, signature, error.InvalidSignatureLength);
    xmss.verify(&key, &signed, &bytes) catch |err| switch (err) {
        error.InvalidSignature => return js.Boolean.from(false),
        else => return err,
    };
    return js.Boolean.from(true);
}

const VerifyAggregateTask = struct {
    arena: std.heap.ArenaAllocator,
    proof: []const u8,
    claims: []const xmss.Claim,
    valid: bool = false,

    /// A proof that does not decode or does not prove the claims is invalid.
    /// Anything else, malformed claims included, is the caller's error.
    pub fn compute(self: *VerifyAggregateTask) !void {
        const proof = leanvm.Proof.fromBytes(self.proof, self.claims) catch |err| switch (err) {
            error.MalformedEncoding, error.MalformedClaim => return,
            else => return err,
        };
        defer proof.deinit();
        proof.verify() catch |err| switch (err) {
            error.Snark, error.MalformedClaim => return,
            else => return err,
        };
        self.valid = true;
    }

    pub fn resolve(self: *VerifyAggregateTask, _: napi.Env) js.Boolean {
        return js.Boolean.from(self.valid);
    }

    pub fn deinit(self: *VerifyAggregateTask) void {
        self.arena.deinit();
    }
};

/// Resolves with whether `proof` proves exactly `claims`: packed, strictly
/// sorted. Rejects with `MalformedSignerSet` when they are not.
pub fn verifyAggregate(proof: js.Uint8Array, claims: js.Uint8Array) !js.Value {
    try ensureAvailable();
    var arena: std.heap.ArenaAllocator = .init(js.allocator());
    errdefer arena.deinit();
    const allocator = arena.allocator();

    const task: VerifyAggregateTask = .{
        .proof = try allocator.dupe(u8, try proof.toSlice()),
        .claims = try dupePacked(xmss.Claim, allocator, claims, error.InvalidClaimsLength),
        .arena = arena,
    };
    return js.spawn(VerifyAggregateTask, task, "leanvm.verifyAggregate");
}

const ChildInput = struct {
    proof: js.Uint8Array,
    claims: js.Uint8Array,
};

const Child = struct {
    proof: []const u8,
    claims: []const xmss.Claim,
};

const AggregateTask = struct {
    arena: std.heap.ArenaAllocator,
    children: []const Child,
    signed: []const xmss.Signed,
    declare: ?[]const xmss.Claim,
    log_inv_rate: u32,
    proof: []const u8 = &.{},
    claims: []const xmss.Claim = &.{},

    pub fn compute(self: *AggregateTask) !void {
        var decoded: [leanvm.max_recursions]*leanvm.Proof = undefined;
        var count: usize = 0;
        defer for (decoded[0..count]) |child| child.deinit();
        for (self.children) |child| {
            decoded[count] = leanvm.Proof.fromBytes(child.proof, child.claims) catch |err| switch (err) {
                error.MalformedEncoding, error.MalformedClaim, error.MalformedSignerSet => return error.InvalidChild,
                else => return err,
            };
            count += 1;
        }

        const proof = try leanvm.aggregate(.{
            .children = decoded[0..count],
            .signed = self.signed,
            .declare = self.declare,
        }, self.log_inv_rate);
        defer proof.deinit();
        const allocator = self.arena.allocator();
        self.proof = try proof.toBytes(allocator);
        self.claims = try proof.claims(allocator);
    }

    pub fn resolve(self: *AggregateTask, env: napi.Env) !napi.Value {
        const result = try env.createObject();
        try result.setNamedProperty("proof", js.Uint8Array.from(self.proof).toValue());
        try result.setNamedProperty("claims", js.Uint8Array.from(std.mem.sliceAsBytes(self.claims)).toValue());
        return result;
    }

    pub fn deinit(self: *AggregateTask) void {
        self.arena.deinit();
    }
};

/// Resolves with `{proof, claims}`: a proof that every one of its packed,
/// sorted `claims` is backed by a valid leanXMSS signature.
///
/// - `children`: at most `MAX_RECURSIONS` earlier results, each `{proof, claims}`.
/// - `signed`: packed signed claims, in any order.
/// - `declare`: undefined publishes every claim of the children and of
///   `signed`. Otherwise exactly these packed, strictly sorted claims are
///   published, each covered by a child or by `signed`.
/// - `log_inv_rate`: in `MIN_LOG_INV_RATE..=MAX_LOG_INV_RATE`. Higher is a
///   smaller proof and a slower prover.
///
/// Neither the children nor the signatures are verified first: an invalid one
/// rejects, usually with `Prove`, and never yields a proof of a false claim.
/// Aggregations run one at a time.
pub fn aggregate(
    children: js.Array,
    signed: js.Uint8Array,
    declare: ?js.Uint8Array,
    log_inv_rate: js.Number,
) !js.Value {
    try ensureAvailable();
    const child_count = try children.length();
    if (child_count > leanvm.max_recursions) return error.TooManyChildren;

    var arena: std.heap.ArenaAllocator = .init(js.allocator());
    errdefer arena.deinit();
    const allocator = arena.allocator();

    const copied = try allocator.alloc(Child, child_count);
    for (copied, 0..) |*child, i| {
        const input = try (try (try children.get(@intCast(i))).asObject(ChildInput)).get();
        child.* = .{
            .proof = try allocator.dupe(u8, try input.proof.toSlice()),
            .claims = try dupePacked(xmss.Claim, allocator, input.claims, error.InvalidClaimsLength),
        };
    }

    const task: AggregateTask = .{
        .children = copied,
        .signed = try dupePacked(xmss.Signed, allocator, signed, error.InvalidSignedLength),
        .declare = if (declare) |claims|
            try dupePacked(xmss.Claim, allocator, claims, error.InvalidClaimsLength)
        else
            null,
        .log_inv_rate = try log_inv_rate.toU32Exact(),
        .arena = arena,
    };
    return js.spawn(AggregateTask, task, "leanvm.aggregate");
}
