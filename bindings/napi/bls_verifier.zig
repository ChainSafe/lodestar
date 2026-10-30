const std = @import("std");
const zapi = @import("zapi:zapi");
const js = zapi.js;
const bls = @import("bls");
const preset = @import("preset").preset;
const signature_set_verifier = @import("state_transition").signature_set_verifier;

const blst_bindings = @import("./blst.zig");
const pubkeys = @import("./pubkeys.zig");

/// Bound synchronous NAPI work and the fixed stack buffers below. Lodestar's
/// worker jobs normally contain at most 128 sets, so 256 provides headroom while
/// requiring unusually large direct callers to chunk explicitly.
pub const MAX_BATCH_SIZE = 256;
pub const MAX_SAME_MESSAGE_BATCH_SIZE = bls.MAX_AGGREGATE_PER_JOB;
const max_indices_per_set = preset.MAX_VALIDATORS_PER_COMMITTEE * preset.MAX_COMMITTEES_PER_SLOT;

const SignatureSetBatch = signature_set_verifier.SignatureSetBatch(MAX_BATCH_SIZE);
const SameMessageSignatureSetBatch = signature_set_verifier.SameMessageSignatureSetBatch(MAX_SAME_MESSAGE_BATCH_SIZE);

pub const SetType = enum(u32) {
    indexed = 0,
    aggregate = 1,
    single = 2,
};

const CommonSet = struct {
    type: js.Number,
    message: js.Uint8Array,
    signature: js.Uint8Array,
};

const IndexedSet = struct { index: js.Number };
const AggregateSet = struct { indices: js.Uint32Array };
const SingleSet = struct { pubkey: js.Uint8Array };

const SameMessageSet = struct {
    index: js.Number,
    signature: js.Uint8Array,
};

/// Verify indexed, aggregate, and raw-pubkey signature sets synchronously.
///
/// Returns false when:
/// 1. A signature is malformed or invalid cryptographically.
/// 2. A raw public key is malformed or invalid cryptographically.
///
/// Throws for malformed inputs and cache misses encountered before a result is known.
pub fn verifySignatureSets(sets: js.Array) !js.Boolean {
    const count = try sets.length();
    if (count == 0) return js.Boolean.from(false);
    if (count > MAX_BATCH_SIZE) return error.TooManySets;

    var batch: SignatureSetBatch = .{};
    const io = js.io();

    for (0..count) |i| {
        const value = try sets.get(@intCast(i));
        const set = try (try value.asObject(CommonSet)).get();
        const set_type: SetType = switch (try set.type.toU32Exact()) {
            @intFromEnum(SetType.indexed) => .indexed,
            @intFromEnum(SetType.aggregate) => .aggregate,
            @intFromEnum(SetType.single) => .single,
            else => return error.InvalidSetType,
        };

        const message = try set.message.toSlice();
        if (message.len != 32) return error.InvalidMessageLength;

        const public_key: bls.PublicKey = switch (set_type) {
            .indexed => blk: {
                if (!pubkeys.state.initialized) return error.PubkeyIndexNotInitialized;
                const indexed = try (try value.asObject(IndexedSet)).get();
                const index = try indexed.index.toU32Exact();
                break :blk pubkeys.state.cache.getPubkey(io, index) orelse
                    return error.PubkeyIndexNotFound;
            },
            .aggregate => blk: {
                if (!pubkeys.state.initialized) return error.PubkeyIndexNotInitialized;
                const aggregate = try (try value.asObject(AggregateSet)).get();
                const indices = try aggregate.indices.toSlice();
                if (indices.len > max_indices_per_set) return error.TooManyIndices;
                break :blk pubkeys.state.cache.aggregateIndices(io, u32, indices) catch |err| switch (err) {
                    error.InvalidIndex => return error.PubkeyIndexNotFound,
                    error.InvalidLength => return error.EmptyIndices,
                };
            },
            .single => blk: {
                const single = try (try value.asObject(SingleSet)).get();
                const bytes = try single.pubkey.toSlice();
                break :blk bls.PublicKey.keyValidate(bytes) catch return js.Boolean.from(false);
            },
        };

        const signature = try set.signature.toSlice();
        if (!batch.append(&public_key, message[0..32], signature)) return js.Boolean.from(false);
    }

    const pool = blst_bindings.state.thread_pool orelse return error.ThreadPoolNotInitialized;
    return js.Boolean.from(try batch.verify(io, pool));
}

/// Randomly aggregate and verify indexed signatures over the same message.
///
/// Returns one validity result per input, preserving order. Uses aggregate
/// verification with individual fallback. Throws on invalid input, cache
/// errors, or pool unavailability.
pub fn verifySignatureSetsSameMessage(sets: js.Array, message: js.Uint8Array) !js.Array {
    const count = try sets.length();
    if (count > MAX_SAME_MESSAGE_BATCH_SIZE) return error.TooManySets;

    const results = js.Array.createWithLength(count);
    if (count == 0) return results;

    const message_slice = try message.toSlice();
    if (message_slice.len != 32) return error.InvalidMessageLength;

    if (!pubkeys.state.initialized) return error.PubkeyIndexNotInitialized;

    var batch: SameMessageSignatureSetBatch = .{};

    const io = js.io();
    for (0..count) |i| {
        const value = try sets.get(@intCast(i));
        const set = try (try value.asObject(SameMessageSet)).get();
        const index = try set.index.toU32Exact();
        const public_key = pubkeys.state.cache.getPubkey(io, index) orelse
            return error.PubkeyIndexNotFound;

        batch.append(&public_key, try set.signature.toSlice());
    }

    var verification_results: [MAX_SAME_MESSAGE_BATCH_SIZE]bool = undefined;
    const pool = blst_bindings.state.thread_pool orelse return error.ThreadPoolNotInitialized;
    try batch.verify(
        io,
        pool,
        message_slice[0..32],
        verification_results[0..count],
    );

    for (0..count) |i| {
        try results.set(@intCast(i), js.Boolean.from(verification_results[i]));
    }

    return results;
}
