/// Number of random bytes used for verification.
const RAND_BYTES = 8;

/// Number of random bits used for verification.
const RAND_BITS = 8 * RAND_BYTES;

/// Borrowed signature-set inputs and an owned random coefficient for batch verification.
/// Input pointers must remain valid until verification completes.
pub const BatchVerifyItem = struct {
    message: *const SigningRoot,
    public_key: *const PublicKey,
    signature: *const Signature,
    randomness: [32]u8,
};

/// Verify multiple aggregate signatures efficiently using random coefficients.
///
/// Source: https://ethresear.ch/t/fast-verification-of-multiple-bls-signatures/5407
///
/// Returns true if verification succeeds, false if verification fails, `BlstError` on error.
pub fn verifyMultipleAggregateSignatures(
    pairing_buf: *align(Pairing.buf_align) [Pairing.sizeOf()]u8,
    items: []const BatchVerifyItem,
    dst: []const u8,
    pks_validate: bool,
    sigs_groupcheck: bool,
) BlstError!bool {
    if (items.len == 0) {
        return error.VerifyFail;
    }

    var pairing = Pairing.init(
        pairing_buf,
        true,
        dst,
    );

    for (items) |*item| {
        try pairing.mulAndAggregate(
            item.public_key,
            pks_validate,
            item.signature,
            sigs_groupcheck,
            &item.randomness,
            RAND_BITS,
            item.message,
        );
    }

    pairing.commit();

    return pairing.finalVerify(null);
}

const BlstError = @import("error.zig").BlstError;
const Pairing = @import("Pairing.zig");
const blst = @import("root.zig");
const PublicKey = blst.PublicKey;
const Signature = blst.Signature;
const SigningRoot = blst.SigningRoot;
