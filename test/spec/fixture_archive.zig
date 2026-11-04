const std = @import("std");
const builtin = @import("builtin");
const Allocator = std.mem.Allocator;

const max_attempts = 3;
const retry_delay: std.Io.Clock.Duration = .{ .raw = .fromSeconds(2), .clock = .awake };
const archive_name = "archive.download";

pub const Headers = []const std.http.Header;

/// Downloads the gzip tarball at `url` and extracts it into `out_dir`, unless `out_dir` exists.
///
/// The archive lands in a sibling `<out_dir>.extracting` directory that is renamed into place only
/// after extraction completes, so an interrupted run never leaves a partial directory that passes
/// as downloaded. A failed attempt is retried up to `max_attempts` times.
pub fn fetch(allocator: Allocator, io: std.Io, url: []const u8, out_dir: []const u8) !void {
    try fetchArchive(allocator, io, url, out_dir, &.{}, .{ .tar_gz = {} });
}

/// Same as `fetch` for a GitHub Actions artifact holding the tarball `tarball_name`. GitHub
/// serves a single-file artifact as the file itself; a zip wrapping it is accepted too.
/// `headers` authenticate the first request only; see `download`.
pub fn fetchArtifact(
    allocator: Allocator,
    io: std.Io,
    url: []const u8,
    out_dir: []const u8,
    tarball_name: []const u8,
    headers: Headers,
) !void {
    try fetchArchive(allocator, io, url, out_dir, headers, .{ .artifact = tarball_name });
}

const Format = union(enum) {
    tar_gz,
    artifact: []const u8,
};

fn fetchArchive(allocator: Allocator, io: std.Io, url: []const u8, out_dir: []const u8, headers: Headers, format: Format) !void {
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
        downloadAndExtract(allocator, io, url, parent, staging_name, headers, format) catch |err| {
            if (attempt >= max_attempts) {
                parent.deleteTree(io, staging_name) catch {};
                return err;
            }
            std.log.warn("attempt {d}/{d} for {s} failed: {s}", .{ attempt, max_attempts, url, @errorName(err) });
            try retry_delay.sleep(io);
            continue;
        };
        break;
    }
    try parent.rename(staging_name, parent, final_name, io);
    std.log.info("extracted {s}", .{out_dir});
}

fn downloadAndExtract(
    allocator: Allocator,
    io: std.Io,
    url: []const u8,
    parent: std.Io.Dir,
    staging_name: []const u8,
    headers: Headers,
    format: Format,
) !void {
    var staging = try parent.createDirPathOpen(io, staging_name, .{});
    defer staging.close(io);

    try download(allocator, io, url, staging, archive_name, headers);
    switch (format) {
        .tar_gz => try extractTarball(io, staging, archive_name),
        .artifact => |tarball_name| switch (try sniff(io, staging, archive_name)) {
            .gzip => try extractTarball(io, staging, archive_name),
            .zip => {
                try unzip(io, staging, archive_name);
                try extractTarball(io, staging, tarball_name);
            },
        },
    }
}

const Magic = enum { gzip, zip };

fn sniff(io: std.Io, dir: std.Io.Dir, name: []const u8) !Magic {
    const file = try dir.openFile(io, name, .{});
    defer file.close(io);
    var magic: [4]u8 = undefined;
    const len = try file.readPositionalAll(io, &magic, 0);
    if (len >= 2 and std.mem.eql(u8, magic[0..2], "\x1f\x8b")) return .gzip;
    if (len == 4 and std.mem.eql(u8, &magic, "PK\x03\x04")) return .zip;
    std.log.err("{s}: neither a gzip nor a zip archive", .{name});
    return error.UnknownArchiveFormat;
}

fn extractTarball(io: std.Io, dir: std.Io.Dir, name: []const u8) !void {
    const archive = try dir.openFile(io, name, .{});
    defer archive.close(io);
    var read_buffer: [64 * 1024]u8 = undefined;
    var file_reader = archive.reader(io, &read_buffer);
    var decompress_buffer: [std.compress.flate.max_window_len]u8 = undefined;
    var decompressor = std.compress.flate.Decompress.init(&file_reader.interface, .gzip, &decompress_buffer);
    try std.tar.pipeToFileSystem(io, dir, &decompressor.reader, .{});
    try dir.deleteFile(io, name);
}

fn unzip(io: std.Io, dir: std.Io.Dir, name: []const u8) !void {
    const archive = try dir.openFile(io, name, .{});
    defer archive.close(io);
    var read_buffer: [64 * 1024]u8 = undefined;
    var file_reader = archive.reader(io, &read_buffer);
    try std.zip.extract(dir, &file_reader, .{});
    try dir.deleteFile(io, name);
}

/// Streams the whole archive to disk before extraction: extracting many small files inline would
/// stall the connection long enough for the server to close it.
///
/// With `headers`, the first redirect is followed by hand without them: GitHub answers an
/// authenticated artifact request with a signed storage URL that rejects the token as well.
fn download(allocator: Allocator, io: std.Io, url: []const u8, dir: std.Io.Dir, name: []const u8, headers: Headers) !void {
    switch (try request(allocator, io, url, dir, name, headers)) {
        .saved => {},
        .redirect => |target| {
            defer allocator.free(target);
            switch (try request(allocator, io, target, dir, name, &.{})) {
                .saved => {},
                .redirect => |again| {
                    allocator.free(again);
                    return error.HttpRedirectLoop;
                },
            }
        },
    }
}

const RequestOutcome = union(enum) {
    saved,
    /// Only returned for an authenticated request; the caller owns the target URL.
    redirect: []u8,
};

fn request(allocator: Allocator, io: std.Io, url: []const u8, dir: std.Io.Dir, name: []const u8, headers: Headers) !RequestOutcome {
    std.log.info("downloading {s}", .{url});
    var client: std.http.Client = .{ .allocator = allocator, .io = io };
    defer client.deinit();
    var request_options: std.http.Client.RequestOptions = .{ .extra_headers = headers };
    if (headers.len != 0) request_options.redirect_behavior = .unhandled;
    var req = try client.request(.GET, try std.Uri.parse(url), request_options);
    defer req.deinit();
    if (req.connection) |connection| try enableKeepalive(connection.stream_reader.stream.socket.handle);
    try req.sendBodiless();
    var redirect_buffer: [8 * 1024]u8 = undefined;
    var response = try req.receiveHead(&redirect_buffer);
    if (response.head.status.class() == .redirect and headers.len != 0) {
        const location = response.head.location orelse return error.HttpRedirectLocationMissing;
        return .{ .redirect = try allocator.dupe(u8, location) };
    }
    if (response.head.status.class() != .success) {
        std.log.err("{s}: HTTP {d} {s}", .{ url, @intFromEnum(response.head.status), response.head.status.phrase() orelse "" });
        return error.DownloadFailed;
    }

    const file = try dir.createFile(io, name, .{});
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
    return .saved;
}

const keepalive_idle_seconds: c_int = 30;
const keepalive_interval_seconds: c_int = 10;
const keepalive_probe_count: c_int = 3;

/// A peer that vanishes mid-body otherwise holds the read open until the kernel's retransmit
/// timeout, tens of minutes; probing turns it into `error.Timeout` within about a minute so the
/// retry loop can take over. The threaded Io treats a receive timeout (`EAGAIN`) as a bug, so
/// `SO_RCVTIMEO` is not an option.
fn enableKeepalive(handle: std.posix.socket_t) !void {
    const posix = std.posix;
    const enabled: c_int = 1;
    try posix.setsockopt(handle, posix.SOL.SOCKET, posix.SO.KEEPALIVE, std.mem.asBytes(&enabled));
    const idle_option = if (builtin.os.tag.isDarwin()) posix.TCP.KEEPALIVE else posix.TCP.KEEPIDLE;
    try posix.setsockopt(handle, posix.IPPROTO.TCP, idle_option, std.mem.asBytes(&keepalive_idle_seconds));
    try posix.setsockopt(handle, posix.IPPROTO.TCP, posix.TCP.KEEPINTVL, std.mem.asBytes(&keepalive_interval_seconds));
    try posix.setsockopt(handle, posix.IPPROTO.TCP, posix.TCP.KEEPCNT, std.mem.asBytes(&keepalive_probe_count));
}
