const std = @import("std");
const download_era_options = @import("download_era_options");

pub fn main(init: std.process.Init) !void {
    const allocator = init.arena.allocator();
    const io = init.io;

    for (download_era_options.era_files) |era_file| {
        try download_era_file(
            allocator,
            io,
            download_era_options.era_base_url,
            era_file,
            download_era_options.era_out_dir,
        );
    }
}

fn download_era_file(
    allocator: std.mem.Allocator,
    io: std.Io,
    base_url: []const u8,
    era_file: []const u8,
    out_dir: []const u8,
) !void {
    // Ensure the output directory exists before creating the file
    try std.Io.Dir.createDirPath(.cwd(), io, out_dir);

    // If the file already exists, return early
    const out_path = try std.fs.path.join(allocator, &[_][]const u8{ out_dir, era_file });
    defer allocator.free(out_path);

    if (std.Io.Dir.openFile(.cwd(), io, out_path, .{})) |f| {
        std.log.info("{s} already downloaded", .{
            era_file,
        });
        f.close(io);
        return;
    } else |_| {}

    std.log.info("Downloading {s} from {s}", .{
        era_file,
        base_url,
    });

    const url = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ base_url, era_file });
    defer allocator.free(url);

    var client: std.http.Client = .{ .allocator = allocator, .io = io };
    defer client.deinit();

    // Prepare and send the request
    const uri = try std.Uri.parse(url);
    var req = try client.request(.GET, uri, .{});
    defer req.deinit();

    try req.sendBodiless();

    var redirect_buffer: [8 * 1024]u8 = undefined;
    var response = try req.receiveHead(&redirect_buffer);

    // Handle non-200 response
    if (response.head.status.class() != .success) {
        std.log.err("Failed to download {s}: {s}", .{
            era_file,
            response.head.status.phrase() orelse "Unknown error",
        });
        return error.DownloadFailed;
    }

    // Stream the response to a file
    std.log.info("Writing {s}", .{
        out_path,
    });

    const file = try std.Io.Dir.createFile(.cwd(), io, out_path, .{});
    defer file.close(io);

    var write_buf: [16 * 1024]u8 = undefined;
    var file_writer = file.writer(io, &write_buf);
    var body_reader = response.reader(&.{});
    const bytes_count = body_reader.streamRemaining(&file_writer.interface) catch |err| switch (err) {
        error.ReadFailed => return response.bodyErr().?,
        else => |e| return e,
    };
    try file_writer.end();

    std.log.info("Written {s}: {d} bytes", .{
        era_file,
        bytes_count,
    });
}
