const std = @import("std");
const bls = @import("bls");
const types = @import("consensus_types");
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
