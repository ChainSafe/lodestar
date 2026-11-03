const std = @import("std");

pub fn waitForDatagram(socket: std.Io.net.Socket) !void {
    var messages: [1]std.Io.net.IncomingMessage = .{.init};
    var buffer: [1]u8 = undefined;
    const failure, const count = socket.receiveManyTimeout(std.testing.io, &messages, &buffer, .{ .peek = true }, .{ .duration = .{
        .raw = .fromSeconds(1),
        .clock = .awake,
    } });
    if (failure) |err| return err;
    try std.testing.expectEqual(@as(usize, 1), count);
}
