const std = @import("std");
const blst = @import("blst");
const sha256 = @import("sha256.zig");
const StdSha256 = std.crypto.hash.sha2.Sha256;

fn expectDigest(expected_hex: *const [64]u8, message: []const u8) !void {
    var digest: [sha256.digest_length]u8 = undefined;
    sha256.hash(message, &digest);
    try std.testing.expectEqualStrings(expected_hex, &std.fmt.bytesToHex(digest, .lower));
}

test "hash should match known SHA-256 digests" {
    try expectDigest("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "");
    try expectDigest("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "abc");
    try expectDigest(
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    );
}

test "blst sha256 should match std for every message length up to five blocks" {
    const block_len = StdSha256.block_length;
    var prng = std.Random.DefaultPrng.init(0);
    var message: [5 * block_len]u8 = undefined;
    prng.random().bytes(&message);

    for (0..message.len + 1) |len| {
        var expected: [StdSha256.digest_length]u8 = undefined;
        StdSha256.hash(message[0..len], &expected, .{});
        var actual: [StdSha256.digest_length]u8 = undefined;
        blst.blst_sha256(&actual, &message, len);
        try std.testing.expectEqualSlices(u8, &expected, &actual);
    }
}
