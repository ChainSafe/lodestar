const std = @import("std");
const options = @import("download_ere_fixture_options");

const zkvms = [_][]const u8{ "openvm", "sp1", "zisk" };
const files = [_][]const u8{ "program_vk.bin", "proof.bin", "public_values.bin" };

pub fn main(init: std.process.Init) !void {
    const allocator = init.arena.allocator();
    const io = init.io;

    for (zkvms) |zkvm| {
        for (files) |file| {
            try downloadFixture(allocator, io, zkvm, file);
        }
    }
}

fn downloadFixture(allocator: std.mem.Allocator, io: std.Io, zkvm: []const u8, file: []const u8) !void {
    const out_dir = try std.fs.path.join(allocator, &.{ options.ere_fixture_out_dir, zkvm });
    defer allocator.free(out_dir);
    try std.Io.Dir.createDirPath(.cwd(), io, out_dir);

    const out_path = try std.fs.path.join(allocator, &.{ out_dir, file });
    defer allocator.free(out_path);

    if (std.Io.Dir.openFile(.cwd(), io, out_path, .{})) |f| {
        std.log.info("{s} already downloaded", .{out_path});
        f.close(io);
        return;
    } else |_| {}

    const url = try std.fmt.allocPrint(
        allocator,
        "{s}/crates/verifier/{s}/tests/fixtures/{s}",
        .{ options.ere_fixture_base_url, zkvm, file },
    );
    defer allocator.free(url);

    std.log.info("Downloading {s}", .{url});

    var client: std.http.Client = .{ .allocator = allocator, .io = io };
    defer client.deinit();

    const uri = try std.Uri.parse(url);
    var req = try client.request(.GET, uri, .{});
    defer req.deinit();

    try req.sendBodiless();

    var redirect_buffer: [8 * 1024]u8 = undefined;
    var response = try req.receiveHead(&redirect_buffer);

    if (response.head.status.class() != .success) {
        std.log.err("Failed to download {s}: {s}", .{
            url,
            response.head.status.phrase() orelse "Unknown error",
        });
        return error.DownloadFailed;
    }

    const out_file = try std.Io.Dir.createFile(.cwd(), io, out_path, .{});
    defer out_file.close(io);

    var write_buf: [16 * 1024]u8 = undefined;
    var file_writer = out_file.writer(io, &write_buf);
    var body_reader = response.reader(&.{});
    const bytes_count = body_reader.streamRemaining(&file_writer.interface) catch |err| switch (err) {
        error.ReadFailed => return response.bodyErr().?,
        else => |e| return e,
    };
    try file_writer.end();

    std.log.info("Written {s}: {d} bytes", .{ out_path, bytes_count });
}
