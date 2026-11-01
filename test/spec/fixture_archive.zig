const std = @import("std");
const Allocator = std.mem.Allocator;

const max_attempts = 3;
const retry_delay: std.Io.Clock.Duration = .{ .raw = .fromSeconds(2), .clock = .awake };

/// Downloads the gzip tarball at `url` and extracts it into `out_dir`, unless `out_dir` exists.
///
/// The archive lands in a sibling `<out_dir>.extracting` directory that is renamed into place only
/// after extraction completes, so an interrupted run never leaves a partial directory that passes
/// as downloaded. A failed attempt is retried up to `max_attempts` times.
pub fn fetch(allocator: Allocator, io: std.Io, url: []const u8, out_dir: []const u8) !void {
    const cwd = std.Io.Dir.cwd();
    if (cwd.access(io, out_dir, .{})) |_| {
        std.log.info("already downloaded {s}", .{out_dir});
        return;
    } else |err| switch (err) {
        error.FileNotFound => {},
        else => return err,
    }

    var parent = try cwd.createDirPathOpen(io, std.fs.path.dirname(out_dir) orelse ".", .{});
    defer parent.close(io);
    const final_name = std.fs.path.basename(out_dir);
    const staging_name = try std.fmt.allocPrint(allocator, "{s}.extracting", .{final_name});
    defer allocator.free(staging_name);

    var attempt: usize = 1;
    while (true) : (attempt += 1) {
        try parent.deleteTree(io, staging_name);
        downloadAndExtract(allocator, io, url, parent, staging_name) catch |err| {
            if (attempt >= max_attempts) return err;
            std.log.warn("attempt {d}/{d} for {s} failed: {s}", .{ attempt, max_attempts, url, @errorName(err) });
            try retry_delay.sleep(io);
            continue;
        };
        break;
    }
    try parent.rename(staging_name, parent, final_name, io);
    std.log.info("extracted {s}", .{out_dir});
}

fn downloadAndExtract(allocator: Allocator, io: std.Io, url: []const u8, parent: std.Io.Dir, staging_name: []const u8) !void {
    var staging = try parent.createDirPathOpen(io, staging_name, .{});
    defer staging.close(io);

    try download(allocator, io, url, staging);
    const archive = try staging.openFile(io, archive_name, .{});
    defer archive.close(io);
    var read_buffer: [64 * 1024]u8 = undefined;
    var file_reader = archive.reader(io, &read_buffer);
    var decompress_buffer: [std.compress.flate.max_window_len]u8 = undefined;
    var decompressor = std.compress.flate.Decompress.init(&file_reader.interface, .gzip, &decompress_buffer);
    try std.tar.pipeToFileSystem(io, staging, &decompressor.reader, .{});
    try staging.deleteFile(io, archive_name);
}

const archive_name = "archive.tar.gz";

/// Streams the whole archive to disk before extraction: extracting many small files inline would
/// stall the connection long enough for the server to close it.
fn download(allocator: Allocator, io: std.Io, url: []const u8, staging: std.Io.Dir) !void {
    std.log.info("downloading {s}", .{url});
    var client: std.http.Client = .{ .allocator = allocator, .io = io };
    defer client.deinit();
    var req = try client.request(.GET, try std.Uri.parse(url), .{});
    defer req.deinit();
    try req.sendBodiless();
    var redirect_buffer: [8 * 1024]u8 = undefined;
    var response = try req.receiveHead(&redirect_buffer);
    if (response.head.status.class() != .success) {
        std.log.err("{s}: HTTP {d} {s}", .{ url, @intFromEnum(response.head.status), response.head.status.phrase() orelse "" });
        return error.DownloadFailed;
    }

    const file = try staging.createFile(io, archive_name, .{});
    defer file.close(io);
    var write_buffer: [64 * 1024]u8 = undefined;
    var file_writer = file.writer(io, &write_buffer);
    var transfer_buffer: [64 * 1024]u8 = undefined;
    const body = response.reader(&transfer_buffer);
    const bytes = body.streamRemaining(&file_writer.interface) catch |err| switch (err) {
        error.ReadFailed => return response.bodyErr() orelse err,
        else => return err,
    };
    try file_writer.end();
    std.log.info("downloaded {d} bytes", .{bytes});
}
