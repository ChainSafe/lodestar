const std = @import("std");
const types = @import("types.zig");

test "local crypto errors report tls_failed" {
    const first = types.reasonFromLocalError(false, types.crypto_error_first);
    const last = types.reasonFromLocalError(false, types.crypto_error_last);
    try std.testing.expectEqual(types.CloseReason.tls_failed, first);
    try std.testing.expectEqual(types.CloseReason.tls_failed, last);
    try std.testing.expectEqual(
        types.CloseReason.tls_failed,
        types.reasonFromLocalError(false, 0x174),
    );

    const transport = types.reasonFromLocalError(false, 0x0a);
    try std.testing.expectEqual(@as(u64, 0x0a), transport.transport_error);
    const outside = types.reasonFromLocalError(false, 0x200);
    try std.testing.expectEqual(@as(u64, 0x200), outside.transport_error);
    const application = types.reasonFromLocalError(true, 0x174);
    try std.testing.expectEqual(@as(u64, 0x174), application.transport_error);
}
