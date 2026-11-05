const std = @import("std");
const retry = @import("retry.zig");
const binding = @import("binding.zig");
const limits = @import("limits.zig");
const support = @import("test_support.zig");

test "QUIC Retry tokens bind source endpoint CIDs key and lifetime" {
    const key: [32]u8 = @splat(1);
    const other_key: [32]u8 = @splat(2);
    const original = binding.Cid.fromSlice(&(@as([limits.local_cid_length]u8, @splat(3))));
    const scid = binding.Cid.fromSlice(&(@as([limits.local_cid_length]u8, @splat(4))));
    var buffer: [retry.token_max]u8 = undefined;
    const token = retry.mint(&key, &support.client_address, &original, &scid, 100, &buffer);
    const valid = retry.validate(&key, &support.client_address, &scid, token, 109, 10).?;
    try std.testing.expect(valid.eql(&original));
    try std.testing.expect(retry.validate(&key, &support.client_address, &scid, token, 99, 10) == null);
    try std.testing.expect(retry.validate(&key, &support.client_address, &scid, token, 110, 10) == null);
    try std.testing.expect(retry.validate(&other_key, &support.client_address, &scid, token, 100, 10) == null);
    try std.testing.expect(retry.validate(&key, &support.server_address, &scid, token, 100, 10) == null);
    try std.testing.expect(retry.validate(&key, &support.client_address, &original, token, 100, 10) == null);
    for (0..token.len) |length| try std.testing.expect(retry.validate(&key, &support.client_address, &scid, token[0..length], 100, 10) == null);
    for (0..token.len) |index| {
        buffer[index] ^= 1;
        try std.testing.expect(retry.validate(&key, &support.client_address, &scid, token, 100, 10) == null);
        buffer[index] ^= 1;
    }
}
