const std = @import("std");
const bls = @import("bls");
const types = @import("consensus_types");
const c = @import("constants");
const computeDomain = @import("../utils/domain.zig").computeDomain;
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const BLSPubkey = types.primitive.BLSPubkey.Type;
const Secretkey = bls.SecretKey;

/// Generates a list of BLS public keys for interop testing.
// TODO: store this to a file and cache there
pub fn interopPubkeysCached(validator_count: usize, out: []BLSPubkey) !void {
    if (out.len != validator_count) {
        return error.InvalidLength;
    }

    for (0..validator_count) |i| {
        // only need to set for the first 8 bytes which is u64
        var ikm = [_]u8{0} ** 32;
        const u64_slice = std.mem.bytesAsSlice(u64, ikm[0..8]);
        u64_slice[0] = @intCast(i);
        const sk = try Secretkey.keyGen(&ikm, null);
        const pk = sk.toPublicKey();
        out[i] = (pk.compress());
    }
}

pub fn interopSign(validator_index: usize, message: *const bls.SigningRoot) !bls.Signature {
    var ikm = [_]u8{0} ** 32;
    const u64_slice = std.mem.bytesAsSlice(u64, ikm[0..8]);
    u64_slice[0] = @intCast(validator_index);
    const sk = try Secretkey.keyGen(&ikm, null);
    return @import("../utils/bls.zig").sign(sk, message);
}

/// A pending deposit for `pubkey` with zero withdrawal credentials, signed by the interop key
/// of `signer_index`. A signer other than the pubkey's own index gives an invalid signature.
pub fn interopPendingDeposit(
    genesis_fork_version: types.primitive.Version.Type,
    pubkey: *const BLSPubkey,
    amount: u64,
    signer_index: usize,
) !types.electra.PendingDeposit.Type {
    const message = types.phase0.DepositMessage.Type{
        .pubkey = pubkey.*,
        .withdrawal_credentials = [_]u8{0} ** 32,
        .amount = amount,
    };
    var domain: types.primitive.Domain.Type = undefined;
    try computeDomain(c.DOMAIN_DEPOSIT, genesis_fork_version, c.ZERO_HASH, &domain);
    var signing_root: types.primitive.Root.Type = undefined;
    try computeSigningRoot(types.phase0.DepositMessage, &message, &domain, &signing_root);
    const signature = try interopSign(signer_index, &signing_root);
    return .{
        .pubkey = message.pubkey,
        .withdrawal_credentials = message.withdrawal_credentials,
        .amount = message.amount,
        .signature = signature.compress(),
        .slot = 0,
    };
}
