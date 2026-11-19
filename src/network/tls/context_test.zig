const std = @import("std");
const context = @import("context.zig");
const keys = @import("../wire/keys.zig");
const peer_id = @import("../wire/peer_id.zig");
const c = @import("quiche_zig:quiche");

test "context owns the certificate and derives the local peer id" {
    const host = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{1}));
    var ctx = try context.Context.init(&host, 1_700_000_000, .{ 1, 2, 3, 4, 5, 6, 7, 8 });
    defer ctx.deinit();
    const host_key = host.publicKey();
    try std.testing.expect(ctx.local_peer_id.eql(&peer_id.PeerId.fromPublicKey(&host_key)));

    var state = context.HandshakeState{ .now_unix = 1_700_000_000 };
    const ssl = try ctx.newSsl(&state);
    defer c.SSL_free(ssl);
    try std.testing.expectEqual(&state, context.handshakeState(ssl).?);
}

test "context can create two independent handshakes" {
    const host = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{1}));
    var ctx = try context.Context.init(&host, 1_700_000_000, .{ 8, 7, 6, 5, 4, 3, 2, 1 });
    defer ctx.deinit();
    var first = context.HandshakeState{};
    var second = context.HandshakeState{};
    const ssl_first = try ctx.newSsl(&first);
    defer c.SSL_free(ssl_first);
    const ssl_second = try ctx.newSsl(&second);
    defer c.SSL_free(ssl_second);
    try std.testing.expect(context.handshakeState(ssl_first).? != context.handshakeState(ssl_second).?);
}

test "context disables TLS session tickets" {
    const host = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{1}));
    var ctx = try context.Context.init(&host, 1_700_000_000, .{ 8, 7, 6, 5, 4, 3, 2, 1 });
    defer ctx.deinit();
    try std.testing.expect(c.SSL_CTX_get_options(ctx.ssl_ctx) & c.SSL_OP_NO_TICKET != 0);
}
