const std = @import("std");
const testing = std.testing;
const Verifier = @import("Verifier.zig");

/// Eight zero KoalaBear words pack to a canonical SP1 verifying key.
const sp1_zero_vk = [_]u8{0} ** 32;

test "init fails on targets without the native verifier" {
    if (Verifier.available) return error.SkipZigTest;
    try testing.expectError(error.VerifierUnavailable, Verifier.init(.sp1, &sp1_zero_vk));
}

test "init rejects an unknown zkvm kind" {
    if (!Verifier.available) return error.SkipZigTest;
    try testing.expectError(error.BadKind, Verifier.init(@enumFromInt(7), &sp1_zero_vk));
}

test "init bounds the program verifying key" {
    if (!Verifier.available) return error.SkipZigTest;

    const oversized = try testing.allocator.alloc(u8, Verifier.max_program_vk_bytes + 1);
    defer testing.allocator.free(oversized);

    @memset(oversized, 0);
    try testing.expectError(error.ProgramVkTooLarge, Verifier.init(.sp1, oversized));
}

test "init rejects a malformed program verifying key" {
    if (!Verifier.available) return error.SkipZigTest;
    try testing.expectError(error.DecodeProgramVk, Verifier.init(.sp1, sp1_zero_vk[0..31]));
}

test "verify bounds the proof" {
    if (!Verifier.available) return error.SkipZigTest;

    var verifier = try Verifier.init(.sp1, &sp1_zero_vk);
    defer verifier.deinit();

    const oversized = try testing.allocator.alloc(u8, Verifier.max_proof_bytes + 1);
    defer testing.allocator.free(oversized);

    @memset(oversized, 0);
    var out: [Verifier.max_public_values_bytes]u8 = undefined;
    try testing.expectError(error.ProofTooLarge, verifier.verify(&out, oversized));
}

test "verify rejects a malformed proof" {
    if (!Verifier.available) return error.SkipZigTest;

    var verifier = try Verifier.init(.sp1, &sp1_zero_vk);
    defer verifier.deinit();

    var out: [Verifier.max_public_values_bytes]u8 = undefined;
    try testing.expectError(error.DecodeProof, verifier.verify(&out, "not a proof"));
}
