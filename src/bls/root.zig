const std = @import("std");
const testing = std.testing;

/// Expose c types for lodestar-bun bindings
pub const c = @import("blst");

// blst Zig native types
pub const Pairing = @import("Pairing.zig");
pub const SecretKey = @import("SecretKey.zig");
pub const PublicKey = @import("PublicKey.zig");
pub const Signature = @import("Signature.zig");
pub const AggregatePublicKey = @import("AggregatePublicKey.zig");
pub const AggregateSignature = @import("AggregateSignature.zig");
pub const BlstError = @import("error.zig").BlstError;

/// Ethereum consensus BLS messages are fixed-size signing roots.
pub const SigningRoot = [32]u8;

pub const BatchVerifyItem = @import("fast_verify.zig").BatchVerifyItem;
pub const verifyMultipleAggregateSignatures = @import("fast_verify.zig").verifyMultipleAggregateSignatures;
pub const ThreadPool = @import("ThreadPool.zig");
pub const pippenger = @import("pippenger.zig");
pub const verifier = @import("verifier.zig");

/// Maximum number of signatures that can be aggregated in a single job.
pub const MAX_AGGREGATE_PER_JOB: usize = 128;

/// The domain separation tag (or DST) for the 'minimum pubkey size' signature variant.
///
/// Source: https://github.com/ethereum/consensus-specs/blob/v1.4.0/specs/phase0/beacon-chain.md#bls-signatures
pub const DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_";

test {
    testing.refAllDecls(@This());
    testing.refAllDecls(Pairing);
    testing.refAllDecls(SecretKey);
    testing.refAllDecls(PublicKey);
    testing.refAllDecls(Signature);
    testing.refAllDecls(AggregatePublicKey);
    testing.refAllDecls(AggregateSignature);
    testing.refAllDecls(ThreadPool);
    testing.refAllDecls(pippenger);
    testing.refAllDecls(verifier);
}
