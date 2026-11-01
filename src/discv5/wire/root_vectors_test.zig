const std = @import("std");
const constants = @import("constants.zig");
const message = @import("message.zig");
const packet = @import("packet.zig");

const node_a_id = hexBytes(
    32,
    "aaaa8419e9f49d0083561b48287df592939a8d19947d8c0ef88f2a4856a69fbb",
);
const node_b_id = hexBytes(
    32,
    "bbbb9d047f0488c0b5a93c1c3f2d8bafc7c8ff337024a55434a0d0555de64db9",
);

test "official ordinary PING packet vector" {
    const raw = hexBytes(
        95,
        "00000000000000000000000000000000088b3d4342774649325f313964a39e55" ++
            "ea96c005ad52be8c7560413a7008f16c9e6d2f43bbea8814a546b7409ce783d3" ++
            "4c4f53245d08dab84102ed931f66d1492acb308fa1c6715b9d139b81acbdcc",
    );
    var decode_scratch: packet.DecodeScratch = .{};
    const decoded = try packet.decode(&raw, &node_b_id, &decode_scratch);
    try std.testing.expectEqual(packet.Flag.message, decoded.static_header.flag);
    const expected_nonce = [_]u8{0xff} ** constants.nonce_size;
    try std.testing.expectEqual(expected_nonce, decoded.static_header.nonce);

    const read_key = [_]u8{0} ** 16;
    var decrypt_scratch: packet.DecryptScratch = .{};
    const plaintext = try packet.decrypt(&decoded, &read_key, &decrypt_scratch);
    var message_scratch: message.DecodeScratch = .{};
    const decoded_message = try message.Message.decode(plaintext, &message_scratch);
    try std.testing.expectEqual(message.Message.ping, std.meta.activeTag(decoded_message));
    try std.testing.expectEqualSlices(
        u8,
        &.{ 0x00, 0x00, 0x00, 0x01 },
        decoded_message.ping.request_id.slice(),
    );
    try std.testing.expectEqual(@as(u64, 2), decoded_message.ping.enr_sequence);

    var encoded_buffer: [constants.packet_size_max]u8 = undefined;
    const encoded = try packet.encodeOrdinary(&encoded_buffer, .{
        .packet = .{
            .masking_iv = &decoded.masking_iv,
            .recipient_id = &node_b_id,
            .nonce = &decoded.static_header.nonce,
            .write_key = &read_key,
            .plaintext = plaintext,
        },
        .source_id = &decoded.form.message.source_id,
    });
    try std.testing.expectEqualSlices(u8, &raw, encoded);
}

test "official WHOAREYOU packet vector" {
    const raw = hexBytes(
        63,
        "00000000000000000000000000000000088b3d434277464933a1ccc59f5967ad" ++
            "1d6035f15e528627dde75cd68292f9e6c27d6b66c8100a873fcbaed4e16b8d",
    );
    var decode_scratch: packet.DecodeScratch = .{};
    const decoded = try packet.decode(&raw, &node_b_id, &decode_scratch);
    try std.testing.expectEqual(packet.Flag.whoareyou, decoded.static_header.flag);
    const expected_nonce = hexBytes(16, "0102030405060708090a0b0c0d0e0f10");
    try std.testing.expectEqual(expected_nonce, decoded.form.whoareyou.id_nonce);
    try std.testing.expectEqual(@as(u64, 0), decoded.form.whoareyou.enr_sequence);

    var encoded_buffer: [constants.whoareyou_packet_size]u8 = undefined;
    const encoded = try packet.encodeWhoareyou(&encoded_buffer, .{
        .masking_iv = &decoded.masking_iv,
        .recipient_id = &node_b_id,
        .request_nonce = &decoded.static_header.nonce,
        .id_nonce = &decoded.form.whoareyou.id_nonce,
        .enr_sequence = decoded.form.whoareyou.enr_sequence,
    }, null);
    try std.testing.expectEqualSlices(u8, &raw, encoded);
}

test "official handshake PING packet vector without ENR" {
    const raw = hexBytes(
        194,
        "00000000000000000000000000000000088b3d4342774649305f313964a39e55" ++
            "ea96c005ad521d8c7560413a7008f16c9e6d2f43bbea8814a546b7409ce783d3" ++
            "4c4f53245d08da4bb252012b2cba3f4f374a90a75cff91f142fa9be3e0a5f3ef" ++
            "268ccb9065aeecfd67a999e7fdc137e062b2ec4a0eb92947f0d9a74bfbf44dfb" ++
            "a776b21301f8b65efd5796706adff216ab862a9186875f9494150c4ae06fa4d1" ++
            "f0396c93f215fa4ef524f1eadf5f0f4126b79336671cbcf7a885b1f8bd2a5d83" ++
            "9cf8",
    );
    var decode_scratch: packet.DecodeScratch = .{};
    const decoded = try packet.decode(&raw, &node_b_id, &decode_scratch);
    try std.testing.expectEqual(packet.Flag.handshake, decoded.static_header.flag);
    try std.testing.expectEqual(node_a_id, decoded.form.handshake.source_id);
    try std.testing.expect(decoded.form.handshake.enr == null);
    const expected_key = hexBytes(
        33,
        "039a003ba6517b473fa0cd74aefe99dadfdb34627f90fec6362df85803908f53a5",
    );
    try std.testing.expectEqual(expected_key, decoded.form.handshake.ephemeral_key.*);

    const read_key = hexBytes(16, "4f9fac6de7567d1e3b1241dffe90f662");
    try expectHandshakeVector(&decoded, &raw, &read_key, 1);
}

test "official handshake PING packet vector with ENR" {
    const raw = hexBytes(
        321,
        "00000000000000000000000000000000088b3d4342774649305f313964a39e55" ++
            "ea96c005ad539c8c7560413a7008f16c9e6d2f43bbea8814a546b7409ce783d3" ++
            "4c4f53245d08da4bb23698868350aaad22e3ab8dd034f548a1c43cd246be9856" ++
            "2fafa0a1fa86d8e7a3b95ae78cc2b988ded6a5b59eb83ad58097252188b902b2" ++
            "1481e30e5e285f19735796706adff216ab862a9186875f9494150c4ae06fa4d1" ++
            "f0396c93f215fa4ef524e0ed04c3c21e39b1868e1ca8105e585ec17315e755e6" ++
            "cfc4dd6cb7fd8e1a1f55e49b4b5eb024221482105346f3c82b15fdaae36a3bb1" ++
            "2a494683b4a3c7f2ae41306252fed84785e2bbff3b022812d0882f06978df84a" ++
            "80d443972213342d04b9048fc3b1d5fcb1df0f822152eced6da4d3f6df27e70e" ++
            "4539717307a0208cd208d65093ccab5aa596a34d7511401987662d8cf62b1394" ++
            "71",
    );
    var decode_scratch: packet.DecodeScratch = .{};
    const decoded = try packet.decode(&raw, &node_b_id, &decode_scratch);
    try std.testing.expectEqual(packet.Flag.handshake, decoded.static_header.flag);
    try std.testing.expect(decoded.form.handshake.enr != null);

    const read_key = hexBytes(16, "53b1c075f41876423154e157470c2f48");
    try expectHandshakeVector(&decoded, &raw, &read_key, 1);
}

fn expectHandshakeVector(
    decoded: *const packet.Packet,
    raw: []const u8,
    read_key: *const [16]u8,
    expected_sequence: u64,
) !void {
    var decrypt_scratch: packet.DecryptScratch = .{};
    const plaintext = try packet.decrypt(decoded, read_key, &decrypt_scratch);
    var message_scratch: message.DecodeScratch = .{};
    const decoded_message = try message.Message.decode(plaintext, &message_scratch);
    try std.testing.expectEqual(message.Message.ping, std.meta.activeTag(decoded_message));
    try std.testing.expectEqual(expected_sequence, decoded_message.ping.enr_sequence);

    var encoded_buffer: [constants.packet_size_max]u8 = undefined;
    const encoded = try packet.encodeHandshake(&encoded_buffer, .{
        .packet = .{
            .masking_iv = &decoded.masking_iv,
            .recipient_id = &node_b_id,
            .nonce = &decoded.static_header.nonce,
            .write_key = read_key,
            .plaintext = plaintext,
        },
        .authdata = decoded.header[constants.static_header_size..],
    });
    try std.testing.expectEqualSlices(u8, raw, encoded);
}

fn hexBytes(comptime length: usize, comptime encoded: []const u8) [length]u8 {
    var result: [length]u8 = undefined;
    _ = std.fmt.hexToBytes(&result, encoded) catch unreachable;
    return result;
}
