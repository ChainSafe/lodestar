const std = @import("std");
const bls = @import("root.zig");

const PublicKey = bls.PublicKey;
const Signature = bls.Signature;
const SigningRoot = bls.SigningRoot;
const Pairing = bls.Pairing;
const ThreadPool = bls.ThreadPool;
const BatchVerifyItem = bls.BatchVerifyItem;
const DST = bls.DST;
const MAX_AGGREGATE_PER_JOB = bls.MAX_AGGREGATE_PER_JOB;

/// A correct RNG produces an all-zero 64-bit scalar with probability 2^-64.
/// Keep retries bounded so a broken RNG fails instead of looping forever.
const random_scalar_retries_max = 8;

pub const VerifySignatureSetsOptions = struct {
    pks_validate: bool = true,
    sigs_groupcheck: bool = true,
};

pub fn ensureNonzeroRandomScalar(io: std.Io, scalar: *[8]u8) !void {
    if (!std.mem.allEqual(u8, scalar, 0)) return;

    for (0..random_scalar_retries_max) |_| {
        io.random(scalar);
        if (!std.mem.allEqual(u8, scalar, 0)) return;
    }
    return error.RandomScalarGenerationFailed;
}

pub fn verifySignatureSets(
    io: std.Io,
    pool: *ThreadPool,
    items: []BatchVerifyItem,
    options: VerifySignatureSetsOptions,
) !bool {
    if (items.len == 0) return false;
    if (items.len == 1) {
        const item = &items[0];
        item.signature.verify(
            options.sigs_groupcheck,
            item.message,
            DST,
            null,
            item.public_key,
            options.pks_validate,
        ) catch return false;
        return true;
    }

    for (items) |*item| {
        io.random(&item.randomness);
        try ensureNonzeroRandomScalar(io, item.randomness[0..8]);
    }

    return pool.verifyMultipleAggregateSignatures(
        io,
        items,
        DST,
        options.pks_validate,
        options.sigs_groupcheck,
    );
}

pub fn verifySameMessage(
    io: std.Io,
    pool: *ThreadPool,
    public_keys: []*const PublicKey,
    signatures: []*const Signature,
    message: *const SigningRoot,
) !bool {
    if (public_keys.len == 0 or public_keys.len != signatures.len) return error.InvalidLength;
    if (public_keys.len > MAX_AGGREGATE_PER_JOB) return error.TooManySignatureSets;

    var randomness: [MAX_AGGREGATE_PER_JOB * 32]u8 = undefined;
    io.random(randomness[0 .. public_keys.len * 32]);
    for (0..public_keys.len) |i| {
        try ensureNonzeroRandomScalar(io, randomness[i * 32 ..][0..8]);
    }

    var aggregate_public_key: PublicKey = undefined;
    var aggregate_signature: Signature = undefined;
    try pool.aggregateWithRandomness(
        io,
        public_keys,
        signatures,
        randomness[0 .. public_keys.len * 32],
        false,
        false,
        &aggregate_public_key,
        &aggregate_signature,
    );

    var pairing_buffer: [Pairing.sizeOf()]u8 align(Pairing.buf_align) = undefined;
    return aggregate_signature.fastAggregateVerifyPreAggregated(
        false,
        &pairing_buffer,
        message,
        DST,
        &aggregate_public_key,
    ) catch false;
}

test {
    _ = @import("verifier_test.zig");
}
