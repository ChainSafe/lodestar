const std = @import("std");
const leanvm = @import("root.zig");
const xmss = leanvm.xmss;

test "sign, aggregate, verify" {
    if (!leanvm.available) {
        try std.testing.expectError(error.Unavailable, leanvm.setup());
        return;
    }
    const allocator = std.testing.allocator;
    try std.testing.expect(leanvm.cpuSupported());
    try leanvm.setup();

    // Three signatures by two keys over two messages.
    const first = try xmss.SecretKey.fromSeed(&@splat(1));
    defer first.deinit();
    const second = try xmss.SecretKey.generate();
    defer second.deinit();
    try std.testing.expectEqual(@as(xmss.Seed, @splat(1)), try first.seed());
    try first.prepare(7);

    const message_a: xmss.Message = @splat(0xaa);
    const message_b: xmss.Message = @splat(0xbb);
    const signed = [_]xmss.Signed{
        .{ .public_key = try first.publicKey(), .message = message_a, .signature = try first.sign(&message_a, 7) },
        .{ .public_key = try second.publicKey(), .message = message_a, .signature = try second.sign(&message_a, 7) },
        .{ .public_key = try first.publicKey(), .message = message_b, .signature = try first.sign(&message_b, 8) },
    };
    for (&signed) |*s| try xmss.verify(&s.public_key, &s.message, &s.signature);
    try std.testing.expectError(
        error.InvalidSignature,
        xmss.verify(&signed[0].public_key, &message_b, &signed[0].signature),
    );

    // Two leaves, then a root over both, onto the wire and back.
    const left = try leanvm.aggregate(.{ .signed = signed[0..2] }, 2);
    defer left.deinit();
    const right = try leanvm.aggregate(.{ .signed = signed[2..] }, 2);
    defer right.deinit();
    const root = try leanvm.aggregate(.{ .children = &.{ left, right } }, 2);
    defer root.deinit();

    const claims = try root.claims(allocator);
    defer allocator.free(claims);
    var expected: [signed.len]xmss.Claim = undefined;
    for (&expected, &signed) |*claim, *s| claim.* = .{ .public_key = s.public_key, .message = s.message };
    std.mem.sort(xmss.Claim, &expected, {}, xmss.Claim.lessThan);
    try std.testing.expectEqualSlices(xmss.Claim, &expected, claims);

    const bytes = try root.toBytes(allocator);
    defer allocator.free(bytes);
    const received = try leanvm.Proof.fromBytes(bytes, claims);
    defer received.deinit();
    try received.verify();

    // The same bytes do not prove one claim fewer.
    const fewer = try leanvm.Proof.fromBytes(bytes, claims[1..]);
    defer fewer.deinit();
    try std.testing.expectError(error.Snark, fewer.verify());
    try std.testing.expectError(
        error.MalformedSignerSet,
        leanvm.Proof.fromBytes(bytes, &.{ claims[1], claims[0] }),
    );

    // Narrowing to the claims on one message.
    var on_a: [2]xmss.Claim = undefined;
    var n: usize = 0;
    for (claims) |claim| if (std.mem.eql(u8, &claim.message, &message_a)) {
        on_a[n] = claim;
        n += 1;
    };
    const narrowed = try leanvm.aggregate(.{ .children = &.{received}, .declare = &on_a }, 2);
    defer narrowed.deinit();
    try narrowed.verify();
    const kept = try narrowed.claims(allocator);
    defer allocator.free(kept);
    try std.testing.expectEqualSlices(xmss.Claim, &on_a, kept);

    try std.testing.expectError(error.Empty, leanvm.aggregate(.{}, 2));
    try std.testing.expectError(error.NotCovered, leanvm.aggregate(.{ .signed = signed[2..], .declare = &on_a }, 2));
}
