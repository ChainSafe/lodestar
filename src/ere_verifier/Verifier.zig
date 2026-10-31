//! One ere verifier handle bound to a program verifying key.
//!
//! A handle may be shared across threads for concurrent `verify` calls.
//! `deinit` must not overlap with them.

const std = @import("std");
const ere = @import("ere");
const c = ere.c;

const Verifier = @This();

pub const available: bool = ere.available;

/// Discriminants of `ere_verifier_new`. Non-exhaustive so an unknown value
/// reaches ere and fails with `error.BadKind` instead of being undefined
/// behavior.
///
/// Source: https://github.com/eth-act/ere/blob/332d8b1206a85b111b4051d2f8e7162ed3b3bb33/bindings/c/src/lib.rs#L27-L32
pub const ZkvmKind = enum(u32) {
    openvm = 0,
    sp1 = 1,
    zisk = 2,
    lambdavm = 3,
    _,
};

/// LambdaVM keys: 116 KiB
/// OpenVM keys: 367 bytes
/// SP1 and ZisK keys: 32 bytes
///
/// Source: https://github.com/eth-act/ere/tree/332d8b1206a85b111b4051d2f8e7162ed3b3bb33/crates/verifier/lambdavm/tests/fixtures
pub const max_program_vk_bytes: usize = 1 << 20;

/// EIP-8025 `MAX_PROOF_SIZE`.
///
/// Spec: https://github.com/ethereum/consensus-specs/blob/a06852f7fad3d6c4557808f48ad7a32ed7cbf996/specs/_features/eip8025/beacon-chain.md#execution
pub const max_proof_bytes: usize = 4 << 20;

/// OpenVM and ZisK return fixed 256-byte public values.
/// SP1 returns the 43 bytes the guest commits, the SSZ `PublicInput`.
///
/// Source: https://github.com/eth-act/ere/blob/332d8b1206a85b111b4051d2f8e7162ed3b3bb33/crates/verifier/openvm/src/verifier.rs#L14
/// Spec: https://github.com/ethereum/consensus-specs/blob/a06852f7fad3d6c4557808f48ad7a32ed7cbf996/specs/_features/eip8025/beacon-chain.md?plain=1#L91-L97
pub const max_public_values_bytes = 256;

/// One error per ere status code.
pub const StatusError = error{
    NullPointer,
    BadKind,
    DecodeProgramVk,
    DecodeProof,
    Verify,
    VerifierInternal,
    Unknown,
};

pub const InitError = StatusError || error{ VerifierUnavailable, ProgramVkTooLarge };
pub const VerifyError = StatusError || error{ VerifierUnavailable, ProofTooLarge, PublicValuesTooLarge };

/// Absent on targets without the library, where `c` is a compile error.
handle: if (available) *c.EreVerifier else void,
kind: ZkvmKind,

pub fn init(kind: ZkvmKind, program_vk: []const u8) InitError!Verifier {
    if (!available) return error.VerifierUnavailable;
    if (program_vk.len > max_program_vk_bytes) return error.ProgramVkTooLarge;

    var handle: ?*c.EreVerifier = null;
    try checkStatus(c.ere_verifier_new(@intFromEnum(kind), program_vk.ptr, program_vk.len, &handle));
    return .{ .handle = handle orelse return error.VerifierInternal, .kind = kind };
}

pub fn deinit(self: *Verifier) void {
    if (!available) return;
    c.ere_verifier_free(self.handle);
    self.* = undefined;
}

/// Verifies a given `proof`.
///
/// Writes the public values the proof commits to into `out` and returns the
/// written slice.
///
/// Fails with `error.DecodeProof` when the bytes do not decode and with
/// `error.Verify` when they decode but do not verify.
pub fn verify(self: *const Verifier, out: *[max_public_values_bytes]u8, proof: []const u8) VerifyError![]const u8 {
    if (!available) return error.VerifierUnavailable;
    if (proof.len > max_proof_bytes) return error.ProofTooLarge;

    var ptr: [*c]u8 = null;
    var len: usize = 0;
    try checkStatus(c.ere_verifier_verify(self.handle, proof.ptr, proof.len, &ptr, &len));
    defer c.ere_bytes_free(ptr, len);
    if (len > max_public_values_bytes) return error.PublicValuesTooLarge;

    if (ptr != null) @memcpy(out[0..len], ptr[0..len]);
    return out[0..len];
}

fn checkStatus(status: i32) StatusError!void {
    return switch (status) {
        c.ERE_OK => {},
        c.ERE_ERR_NULL_PTR => error.NullPointer,
        c.ERE_ERR_BAD_KIND => error.BadKind,
        c.ERE_ERR_DECODE_PROGRAM_VK => error.DecodeProgramVk,
        c.ERE_ERR_DECODE_PROOF => error.DecodeProof,
        c.ERE_ERR_VERIFY => error.Verify,
        c.ERE_ERR_INTERNAL => error.VerifierInternal,
        else => error.Unknown,
    };
}

test {
    _ = @import("verifier_test.zig");
}
