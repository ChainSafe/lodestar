//! Opt-in message lifecycle events through the bounded native log sink. Log timestamps use
//! the monotonic clock; receive frame timestamps use the owner turn's sampled clock. A frame
//! can contain several messages. `active` marks backing acquisition before the first write;
//! `quic_accepted` means QUIC took the entire frame, not that the peer received it.
const std = @import("std");
const topic = @import("topic.zig");

/// Trace every block and a stable 1/64 sample of columns across all lifecycle boundaries.
/// The bounded log sink may drop events; absence of a completion never proves a stalled send.
pub fn selected(kind: topic.Kind, id: topic.MessageId) bool {
    return kind == .beacon_block or (kind == .data_column_sidecar and id[0] & 63 == 0);
}

test "gossip trace selects messages consistently across stages" {
    for (0..256) |value| {
        var id: topic.MessageId = @splat(0);
        id[0] = @intCast(value);
        try std.testing.expect(selected(.beacon_block, id));
        try std.testing.expectEqual(value % 64 == 0, selected(.data_column_sidecar, id));
        try std.testing.expect(!selected(.beacon_attestation, id));
    }
}
