//! [leanVM]'s leanXMSS signatures and their aggregation into proofs, over the
//! Rust crate in `rust/leanvm`, which `build.zig` builds with cargo.
//!
//! `available` is false on a target with no library: every function that would
//! call it then fails with `error.Unavailable`.
//!
//! Key generation, `prepare`, signing and `aggregate` block and fan out over
//! leanVM's own thread pool. Verification is single-threaded.
//!
//! [leanVM]: https://github.com/leanEthereum/leanVM

const std = @import("std");
const builtin = @import("builtin");
const options = @import("leanvm_options");
pub const rust_allocator = @import("allocator.zig");

pub const available: bool = options.leanvm_available;

comptime {
    if (available) {
        @export(&rust_allocator.alloc, .{ .name = "lodestar_leanvm_alloc" });
        @export(&rust_allocator.free, .{ .name = "lodestar_leanvm_free" });
    }
}

// `rust/leanvm` asserts these sizes and limits against leanVM's.
pub const max_recursions = 16;
/// Exclusive cap on an aggregate's claims.
pub const max_keys = 1 << 16;
pub const min_log_inv_rate = 1;
pub const max_log_inv_rate = 4;

pub const Error = error{
    Unavailable,
    /// The leaf index is outside the key's lifetime, or no nonce encodes the message.
    Sign,
    InvalidSignature,
    /// Claims not strictly sorted, or `max_keys` or more of them.
    MalformedSignerSet,
    MalformedClaim,
    /// Bytes that do not decode as a proof.
    MalformedEncoding,
    /// The proof does not prove its claims.
    Snark,
    /// A child `aggregate` could not walk.
    InvalidChild,
    /// Nothing to aggregate.
    Empty,
    /// A declared claim that no child or signature backs.
    NotCovered,
    MalformedRawSignature,
    /// More than `max_recursions` children, or `max_keys` or more claims.
    TooLarge,
    InvalidRate,
    ChildOutOfRange,
    /// Proving failed, as it does on an invalid child or signature.
    Prove,
    Unknown,
};

const Status = enum(i32) {
    ok,
    sign,
    invalid_signature,
    malformed_signer_set,
    malformed_claim,
    malformed_encoding,
    snark,
    invalid_child,
    empty,
    not_covered,
    malformed_raw_signature,
    too_large,
    invalid_rate,
    child_out_of_range,
    prove,
    _,
};

fn check(status: Status) Error!void {
    return switch (status) {
        .ok => {},
        .sign => error.Sign,
        .invalid_signature => error.InvalidSignature,
        .malformed_signer_set => error.MalformedSignerSet,
        .malformed_claim => error.MalformedClaim,
        .malformed_encoding => error.MalformedEncoding,
        .snark => error.Snark,
        .invalid_child => error.InvalidChild,
        .empty => error.Empty,
        .not_covered => error.NotCovered,
        .malformed_raw_signature => error.MalformedRawSignature,
        .too_large => error.TooLarge,
        .invalid_rate => error.InvalidRate,
        .child_out_of_range => error.ChildOutOfRange,
        .prove => error.Prove,
        _ => error.Unknown,
    };
}

/// `rust/leanvm/src/lib.rs`, which nothing checks these declarations against.
/// A slice's pointer may be anything when its length is zero.
const c = struct {
    extern fn leanvm_setup() void;
    extern fn leanvm_xmss_key_gen() *xmss.SecretKey;
    extern fn leanvm_xmss_key_gen_from_seed(seed: *const xmss.Seed) *xmss.SecretKey;
    extern fn leanvm_xmss_secret_key_free(key: *xmss.SecretKey) void;
    extern fn leanvm_xmss_secret_key_seed(key: *const xmss.SecretKey, out_seed: *xmss.Seed) void;
    extern fn leanvm_xmss_secret_key_public_key(key: *const xmss.SecretKey, out_public_key: *xmss.PublicKey) void;
    extern fn leanvm_xmss_secret_key_prepare(key: *const xmss.SecretKey, leaf_index: u32) Status;
    extern fn leanvm_xmss_sign(
        key: *const xmss.SecretKey,
        message: *const xmss.Message,
        leaf_index: u32,
        out_signature: *xmss.Signature,
    ) Status;
    extern fn leanvm_xmss_verify(
        public_key: *const xmss.PublicKey,
        message: *const xmss.Message,
        signature: *const xmss.Signature,
    ) Status;
    extern fn leanvm_aggregate(
        children: [*]const *const Proof,
        children_len: usize,
        signed: [*]const xmss.Signed,
        signed_len: usize,
        declare: [*]const xmss.Claim,
        declare_len: usize,
        has_declare: bool,
        log_inv_rate: u32,
        out_proof: **Proof,
    ) Status;
    extern fn leanvm_proof_from_bytes(
        bytes: [*]const u8,
        bytes_len: usize,
        claims: [*]const xmss.Claim,
        claims_len: usize,
        out_proof: **Proof,
    ) Status;
    extern fn leanvm_proof_free(proof: *Proof) void;
    extern fn leanvm_proof_verify(proof: *const Proof) Status;
    /// Free `out_bytes` with `leanvm_bytes_free`.
    extern fn leanvm_proof_to_bytes(proof: *const Proof, out_bytes: *[*]u8, out_len: *usize) void;
    extern fn leanvm_bytes_free(bytes: [*]u8, len: usize) void;
    extern fn leanvm_proof_claims_len(proof: *const Proof) usize;
    /// `out_claims` holds `leanvm_proof_claims_len` claims.
    extern fn leanvm_proof_claims(proof: *const Proof, out_claims: [*]xmss.Claim) void;
};

/// Whether the running CPU has every instruction set extension the library was
/// built for. Where it does not, any other call may execute an illegal
/// instruction, so check this first.
///
/// Only the baseline `build.zig` picks for a build that may run elsewhere is
/// checked: a build for this machine, or for a `-Drust-cpu` of the builder's
/// choosing, is taken at its word.
pub fn cpuSupported() bool {
    if (!available) return false;
    if (!options.leanvm_baseline_cpu) return true;
    const Verdict = enum(u8) { unknown, no, yes };
    const cached = struct {
        var verdict: std.atomic.Value(Verdict) = .init(.unknown);
    };
    switch (cached.verdict.load(.monotonic)) {
        .unknown => {},
        .no => return false,
        .yes => return true,
    }
    const supported = hostHasBaseline();
    cached.verdict.store(if (supported) .yes else .no, .monotonic);
    return supported;
}

fn hostHasBaseline() bool {
    const host = std.zig.system.resolveTargetQuery(std.Io.Threaded.global_single_threaded.io(), .{}) catch return false;
    return switch (builtin.cpu.arch) {
        // rustc's `haswell`.
        .x86_64 => std.Target.x86.featureSetHasAll(host.cpu.features, .{
            .avx2, .bmi, .bmi2, .f16c, .fma, .lzcnt, .movbe, .pclmul, .popcnt,
        }),
        // rustc's `apple-m1` on macOS, which every arm64 Mac meets.
        .aarch64 => builtin.os.tag == .macos or std.Target.aarch64.featureSetHas(host.cpu.features, .aes),
        else => true,
    };
}

/// Starts the thread pool and compiles the aggregation guest. Optional: it only
/// moves that cost out of the first `aggregate`, `Proof.fromBytes` or `Proof.verify`.
pub fn setup() Error!void {
    if (!available) return error.Unavailable;
    c.leanvm_setup();
}

pub const xmss = struct {
    pub const seed_len = 32;
    pub const message_len = 32;
    pub const public_key_size = 32;
    pub const signature_size = 2404;

    /// All of a key's secret material.
    pub const Seed = [seed_len]u8;
    pub const Message = [message_len]u8;
    pub const PublicKey = [public_key_size]u8;
    pub const Signature = [signature_size]u8;
    /// Its top 16 bits name a bottom tree, its low 16 bits the leaf in it.
    pub const LeafIndex = u32;

    /// `public_key` signed `message`. An aggregate's claims are strictly sorted
    /// by `lessThan`, so they hold no duplicate.
    pub const Claim = extern struct {
        public_key: PublicKey,
        message: Message,

        pub fn lessThan(_: void, a: Claim, b: Claim) bool {
            return std.mem.order(u8, std.mem.asBytes(&a), std.mem.asBytes(&b)) == .lt;
        }
    };

    /// A claim and the signature that backs it.
    pub const Signed = extern struct {
        public_key: PublicKey,
        message: Message,
        signature: Signature,
    };

    /// May be shared across threads. `deinit` must not overlap another call.
    pub const SecretKey = opaque {
        /// A fresh key, its seed from the operating system's randomness.
        pub fn generate() Error!*SecretKey {
            if (!available) return error.Unavailable;
            return c.leanvm_xmss_key_gen();
        }

        /// Regenerates the key's top tree, as key generation does.
        pub fn fromSeed(key_seed: *const Seed) Error!*SecretKey {
            if (!available) return error.Unavailable;
            return c.leanvm_xmss_key_gen_from_seed(key_seed);
        }

        pub fn deinit(self: *SecretKey) void {
            if (!available) return;
            c.leanvm_xmss_secret_key_free(self);
        }

        /// SECRET KEY MATERIAL.
        pub fn seed(self: *const SecretKey) Error!Seed {
            if (!available) return error.Unavailable;
            var out: Seed = undefined;
            c.leanvm_xmss_secret_key_seed(self, &out);
            return out;
        }

        pub fn publicKey(self: *const SecretKey) Error!PublicKey {
            if (!available) return error.Unavailable;
            var out: PublicKey = undefined;
            c.leanvm_xmss_secret_key_public_key(self, &out);
            return out;
        }

        /// Builds the bottom tree `leaf_index` is in, ahead of `sign`: the first
        /// signature in a bottom tree otherwise pays for it.
        pub fn prepare(self: *const SecretKey, leaf_index: LeafIndex) Error!void {
            if (!available) return error.Unavailable;
            try check(c.leanvm_xmss_secret_key_prepare(self, leaf_index));
        }

        /// Deterministic. NEVER sign two different messages with the same key
        /// and leaf index: nothing here records the indices a key has used.
        pub fn sign(self: *const SecretKey, message: *const Message, leaf_index: LeafIndex) Error!Signature {
            if (!available) return error.Unavailable;
            var out: Signature = undefined;
            try check(c.leanvm_xmss_sign(self, message, leaf_index, &out));
            return out;
        }
    };

    /// Fails with `error.InvalidSignature`.
    pub fn verify(public_key: *const PublicKey, message: *const Message, signature: *const Signature) Error!void {
        if (!available) return error.Unavailable;
        try check(c.leanvm_xmss_verify(public_key, message, signature));
    }
};

/// An aggregate: a proof that each of its claims is backed by a valid leanXMSS
/// signature, at a leaf index nothing reveals.
///
/// Its claims are strictly sorted by `xmss.Claim.lessThan` and number fewer
/// than `max_keys`. They count claims, not signers: one key may hold a claim
/// per message.
///
/// May be shared across threads. `deinit` must not overlap another call.
pub const Proof = opaque {
    /// Decodes `bytes` as a proof of the claims `expected`, which the wire does not carry:
    /// the receiver supplies what it expects the proof to attest.
    ///
    /// Decoding does NOT verify: call `verify` before believing the claims.
    pub fn fromBytes(bytes: []const u8, expected: []const xmss.Claim) Error!*Proof {
        if (!available) return error.Unavailable;
        var proof: *Proof = undefined;
        try check(c.leanvm_proof_from_bytes(bytes.ptr, bytes.len, expected.ptr, expected.len, &proof));
        return proof;
    }

    pub fn deinit(self: *Proof) void {
        if (!available) return;
        c.leanvm_proof_free(self);
    }

    /// Fails with `error.Snark` when the proof does not prove its claims.
    pub fn verify(self: *const Proof) Error!void {
        if (!available) return error.Unavailable;
        try check(c.leanvm_proof_verify(self));
    }

    /// The wire encoding, which omits the claims. The caller owns the result.
    pub fn toBytes(self: *const Proof, allocator: std.mem.Allocator) (Error || std.mem.Allocator.Error)![]u8 {
        if (!available) return error.Unavailable;
        var ptr: [*]u8 = undefined;
        var len: usize = 0;
        c.leanvm_proof_to_bytes(self, &ptr, &len);
        defer c.leanvm_bytes_free(ptr, len);
        return allocator.dupe(u8, ptr[0..len]);
    }

    /// The caller owns the result.
    pub fn claims(self: *const Proof, allocator: std.mem.Allocator) (Error || std.mem.Allocator.Error)![]xmss.Claim {
        if (!available) return error.Unavailable;
        const out = try allocator.alloc(xmss.Claim, c.leanvm_proof_claims_len(self));
        c.leanvm_proof_claims(self, out.ptr);
        return out;
    }
};

pub const Inputs = struct {
    /// Earlier aggregates, at most `max_recursions`. Borrowed.
    children: []const *const Proof = &.{},
    /// Signed claims, in any order.
    signed: []const xmss.Signed = &.{},
    /// Null publishes every claim of the children and of `signed`. Otherwise
    /// exactly these claims are published, strictly sorted and each backed by
    /// a child or by `signed`.
    declare: ?[]const xmss.Claim = null,
};

// libc's, which `build.zig` links anyway: `std.Io.Mutex` would need an `Io`.
var aggregate_mutex: std.c.pthread_mutex_t = std.c.PTHREAD_MUTEX_INITIALIZER;

/// Proves the claims it publishes. `log_inv_rate` is in
/// `min_log_inv_rate..=max_log_inv_rate`: higher is a smaller proof and a
/// slower prover.
///
/// Neither the children nor the signatures are verified first. An invalid one
/// usually fails with `error.Prove`, and never yields a proof of a false
/// claim. Calls are serialized here: leanVM must not run two at once.
pub fn aggregate(inputs: Inputs, log_inv_rate: u32) Error!*Proof {
    if (!available) return error.Unavailable;
    _ = std.c.pthread_mutex_lock(&aggregate_mutex);
    defer _ = std.c.pthread_mutex_unlock(&aggregate_mutex);
    const declare = inputs.declare orelse &.{};
    var proof: *Proof = undefined;
    try check(c.leanvm_aggregate(
        inputs.children.ptr,
        inputs.children.len,
        inputs.signed.ptr,
        inputs.signed.len,
        declare.ptr,
        declare.len,
        inputs.declare != null,
        log_inv_rate,
        &proof,
    ));
    return proof;
}

test {
    _ = @import("e2e_test.zig");
}
