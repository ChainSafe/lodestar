const std = @import("std");
const goodbye = @import("goodbye.zig");
const prom = @import("../metrics/registry.zig");

/// Admitted connections by direction and received Goodbye reasons.
pub const Counters = struct {
    connected: [2]u64 = @splat(0),
    goodbyes: [goodbye.count]u64 = @splat(0),

    /// A received Goodbye; unknown wire codes share one reason.
    pub fn goodbyeReceived(self: *Counters, code: u64) void {
        self.goodbyes[@intFromEnum(goodbye.reason(code))] +|= 1;
    }

    pub fn write(self: *const Counters, w: *prom.Encoder) prom.Error!void {
        const connected = try w.family(.{
            .name = "lodestar_peer_connected_total",
            .kind = .counter,
            .help = "Authenticated connections admitted to the native peer manager",
            .labels = &.{ "direction", "status" },
        });
        inline for (.{ "inbound", "outbound" }, 0..) |direction, index| {
            try connected.sample(.{ direction, "open" }, self.connected[index]);
        }
        const goodbyes = try w.family(.{
            .name = "lodestar_peer_goodbye_received_total",
            .kind = .counter,
            .help = "Decoded peer Goodbye requests",
            .labels = &.{"reason"},
        });
        inline for (@typeInfo(goodbye.Reason).@"enum".fields) |field|
            try goodbyes.sample(.{goodbyeLabel(@enumFromInt(field.value))}, self.goodbyes[field.value]);
    }
};

fn goodbyeLabel(reason: goodbye.Reason) []const u8 {
    return switch (reason) {
        .shutdown => "Client shutdown",
        .irrelevant_network => "Irrelevant network",
        .fault => "Internal fault/error",
        .unable_to_verify => "Unable to verify network",
        .too_many_peers => "Client has too many peers",
        .bad_score => "Peer score too low",
        .banned => "Peer banned this node",
        .banned_ip => "Peer banned this IP",
        .unknown => "Unknown",
    };
}

test "peer event metrics bound unknown Goodbye reasons" {
    var counters: Counters = .{};
    counters.goodbyeReceived(129);
    counters.goodbyeReceived(std.math.maxInt(u64));
    try std.testing.expectEqual(@as(u64, 1), counters.goodbyes[@intFromEnum(goodbye.Reason.too_many_peers)]);
    try std.testing.expectEqual(@as(u64, 1), counters.goodbyes[@intFromEnum(goodbye.Reason.unknown)]);
    var buffer: [4096]u8 = undefined;
    var writer = std.Io.Writer.fixed(&buffer);
    var encoder: prom.Encoder = .{ .writer = &writer };
    try counters.write(&encoder);
    try std.testing.expect(std.mem.find(u8, writer.buffered(), "lodestar_peer_goodbye_received_total{reason=\"Unknown\"} 1\n") != null);
}
