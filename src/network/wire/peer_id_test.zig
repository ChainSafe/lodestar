const std = @import("std");
const keys = @import("keys.zig");
const peer_id = @import("peer_id.zig");

const spec_public_key = "0206dc6968726765b820f050263ececf7f71e4955892776c0970542efd689d2382";
const spec_peer_id = "16Uiu2HAkutTMoTzDw1tCvSRtu6YoixJwS46S1ZFxW8hSx9fWHiPs";

fn specKey() !keys.PublicKey {
    var bytes: [keys.public_key_length]u8 = undefined;
    _ = try std.fmt.hexToBytes(&bytes, spec_public_key);
    return keys.PublicKey.fromBytes(&bytes);
}

test "peer id derives the libp2p spec vector" {
    const key = try specKey();
    const id = peer_id.PeerId.fromPublicKey(&key);
    try std.testing.expectEqualSlices(u8, &.{ 0x00, 0x25, 0x08, 0x02, 0x12, 0x21 }, id.bytes[0..6]);
    var text: [peer_id.text_length_max]u8 = undefined;
    try std.testing.expectEqualStrings(spec_peer_id, id.toText(&text));
    try std.testing.expectEqualSlices(u8, &key.bytes, &(try id.publicKey()).bytes);
}

test "peer id parses text and bytes" {
    const key = try specKey();
    const expected = peer_id.PeerId.fromPublicKey(&key);
    const parsed = try peer_id.PeerId.fromText(spec_peer_id);
    try std.testing.expect(parsed.eql(&expected));
    const from_bytes = try peer_id.PeerId.fromBytes(&expected.bytes);
    try std.testing.expect(from_bytes.eql(&expected));
}

test "peer id rejects malformed input" {
    const key = try specKey();
    const id = peer_id.PeerId.fromPublicKey(&key);
    try std.testing.expectError(error.InvalidPeerId, peer_id.PeerId.fromBytes(id.bytes[0..38]));
    var wrong_hash = id.bytes;
    wrong_hash[0] = 0x12;
    try std.testing.expectError(error.InvalidPeerId, peer_id.PeerId.fromBytes(&wrong_hash));
    try std.testing.expectError(error.InvalidText, peer_id.PeerId.fromText("16Uiu2HAkutTMoTzDw1tCvSRtu6YoixJwS46S1ZFxW8hSx9fWHiP0"));
    try std.testing.expectError(error.InvalidText, peer_id.PeerId.fromText(""));
    try std.testing.expectError(error.InvalidPeerId, peer_id.PeerId.fromText("1111"));
    try std.testing.expectError(error.InvalidText, peer_id.PeerId.fromText("1" ** 60));
}
