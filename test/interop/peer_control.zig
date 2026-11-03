const std = @import("std");
extern "c" fn read(c_int, [*]u8, usize) isize;
extern "c" fn write(c_int, [*]const u8, usize) isize;
const PollFd = extern struct { fd: c_int, events: c_short, revents: c_short };
extern "c" fn poll([*]PollFd, c_ulong, c_int) c_int;

pub const Command = struct {
    id: u32,
    op: []const u8,
    address: ?[]const u8 = null,
    topic: ?[]const u8 = null,
    size: ?usize = null,
    seed: ?u32 = null,
    large: ?bool = null,
    paused: ?bool = null,
    capacity: ?usize = null,
    ms: ?u64 = null,
    turns: ?usize = null,
};
pub fn emit(a: std.mem.Allocator, value: anytype) !void {
    const text = try std.json.Stringify.valueAlloc(a, value, .{ .emit_null_optional_fields = false });
    defer a.free(text);
    if (text.len > 65535) return error.OutputBound;
    var offset: usize = 0;
    for (0..65536) |_| {
        if (offset == text.len) break;
        const count = write(1, text[offset..].ptr, text.len - offset);
        if (count <= 0) return error.OutputClosed;
        offset += @intCast(count);
    }
    if (write(1, "\n", 1) != 1) return error.OutputClosed;
}
pub fn run(peer: anytype) !void {
    var line: [65536]u8 = undefined;
    var used: usize = 0;
    var commands: usize = 0;
    var last_id: u32 = 0;
    for (0..10_000_000) |_| {
        if (peer.quit) return;
        var fd = [_]PollFd{.{ .fd = 0, .events = 1, .revents = 0 }};
        if (poll(&fd, 1, if (peer.paused) 1 else 0) < 0) return error.PollFailed;
        if (fd[0].revents != 0) {
            var input: [4096]u8 = undefined;
            const count = read(0, &input, input.len);
            if (count <= 0) return;
            for (input[0..@intCast(count)]) |byte| {
                if (used == line.len) return error.LineBound;
                if (byte != '\n') {
                    line[used] = byte;
                    used += 1;
                    continue;
                }
                commands += 1;
                if (commands > 1024) return error.CommandBound;
                const parsed = try std.json.parseFromSlice(Command, peer.allocator, line[0..used], .{ .max_value_len = 65536 });
                defer parsed.deinit();
                used = 0;
                if (parsed.value.id <= last_id) return error.DuplicateId;
                last_id = parsed.value.id;
                peer.command(parsed.value) catch |err| try emit(peer.allocator, .{ .id = last_id, .ok = false, .err = @errorName(err) });
                if (peer.quit) return;
            }
        }
        if (!peer.paused) try peer.pump();
    }
    return error.StepBound;
}
