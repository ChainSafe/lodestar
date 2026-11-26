const std = @import("std");
const Allocator = std.mem.Allocator;
const spec_test_options = @import("spec_test_options");
const github_actions = @import("github_actions");
const fixture_archive = @import("fixture_archive.zig");

const api_url = "https://api.github.com";
const default_repo = "ethereum/consensus-specs";
const artifacts = [_][]const u8{ "general", "minimal", "mainnet" };
const max_lookup_attempts = 3;
const lookup_delay: std.Io.Clock.Duration = .{ .raw = .fromSeconds(1), .clock = .awake };
const max_api_response_bytes = 4 * 1024 * 1024;

/// Read by the TypeScript spec tests to pick this run over the pinned release.
const nightly_marker = spec_test_options.spec_test_out_dir ++ "/nightly.txt";

pub fn main(init: std.process.Init) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.smp_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const io = init.io;

    const token = try githubToken(allocator, io, init.environ_map);
    const headers = [_]std.http.Header{
        .{ .name = "authorization", .value = try std.fmt.allocPrint(allocator, "token {s}", .{token}) },
        .{ .name = "accept", .value = "application/vnd.github+json" },
    };

    const repo = if (spec_test_options.nightly_repo.len == 0) default_repo else spec_test_options.nightly_repo;
    const branch: ?[]const u8 = if (spec_test_options.nightly_branch.len == 0) null else spec_test_options.nightly_branch;
    const latest = std.mem.eql(u8, spec_test_options.nightly_date, "latest");
    const day = if (latest)
        github_actions.dayFromEpochSeconds(@intCast(@divFloor(std.Io.Clock.real.now(io).nanoseconds, std.time.ns_per_s)))
    else
        github_actions.parseDay(spec_test_options.nightly_date) catch {
            std.log.err("invalid nightly_date \"{s}\": expected \"latest\" or YYYY-MM-DD", .{spec_test_options.nightly_date});
            return error.InvalidDate;
        };

    const query = try github_actions.runsQuery(allocator, day, branch, latest);
    const runs_url = try std.fmt.allocPrint(allocator, "{s}/repos/{s}/actions/workflows/tests.yml/runs?{s}", .{ api_url, repo, query });
    const run = try lookupRun(allocator, io, runs_url, &headers, day);
    std.log.info("resolved nightly {s} to run {d} (created_at={s}, head_sha={s})", .{ day, run.id, run.created_at, run.head_sha });

    const artifacts_url = try std.fmt.allocPrint(allocator, "{s}/repos/{s}/actions/runs/{d}/artifacts", .{ api_url, repo, run.id });
    const run_artifacts = try github_actions.parseArtifacts(allocator, try httpGet(allocator, io, artifacts_url, &headers));

    const version = try std.fmt.allocPrint(allocator, "nightly-{d}", .{run.id});
    var downloaded: usize = 0;
    for (artifacts) |name| {
        const tarball_name = try std.fmt.allocPrint(allocator, "{s}.tar.gz", .{name});
        const url = github_actions.findArtifact(run_artifacts, tarball_name) orelse {
            std.log.warn("skipping {s}: not found in run {d}", .{ name, run.id });
            continue;
        };
        const out_dir = try std.fs.path.join(allocator, &.{ spec_test_options.spec_test_out_dir, version, name });
        try fixture_archive.fetchArtifact(allocator, io, url, out_dir, tarball_name, &headers);
        downloaded += 1;
    }
    if (downloaded == 0) {
        std.log.err("no matching artifacts found in run {d}", .{run.id});
        return error.NoMatchingArtifacts;
    }

    const marker = try std.Io.Dir.cwd().createFile(io, nightly_marker, .{});
    defer marker.close(io);
    try marker.writeStreamingAll(io, version);
    std.log.info("consensus spec tests now use {s}; run `zig build run:download_spec_tests` to return to the pinned release", .{version});
}

fn githubToken(allocator: Allocator, io: std.Io, environ: *const std.process.Environ.Map) ![]const u8 {
    if (environ.get("GITHUB_TOKEN")) |token| if (token.len != 0) return token;
    const env_file = std.Io.Dir.cwd().readFileAlloc(io, ".env", allocator, .limited(64 * 1024)) catch |err| switch (err) {
        error.FileNotFound => "",
        else => return err,
    };
    var lines = std.mem.splitScalar(u8, env_file, '\n');
    while (lines.next()) |line| {
        const trimmed = std.mem.trim(u8, line, " \t\r");
        const assignment = std.mem.cutPrefix(u8, trimmed, "GITHUB_TOKEN=") orelse continue;
        const value = std.mem.trim(u8, assignment, "\"'");
        if (value.len != 0) return value;
    }
    std.log.err("GITHUB_TOKEN is required for nightly downloads: export it or add it to .env", .{});
    return error.MissingGitHubToken;
}

fn lookupRun(allocator: Allocator, io: std.Io, url: []const u8, headers: fixture_archive.Headers, day: github_actions.Day) !github_actions.Run {
    var attempt: usize = 1;
    while (true) : (attempt += 1) {
        const runs = try github_actions.parseRuns(allocator, try httpGet(allocator, io, url, headers));
        return github_actions.selectRun(runs, day) catch |err| {
            if (attempt >= max_lookup_attempts) {
                std.log.err("no successful run created on {s} at {s}", .{ day, url });
                return err;
            }
            std.log.warn("nightly lookup attempt {d}: {s}", .{ attempt, @errorName(err) });
            try lookup_delay.sleep(io);
            continue;
        };
    }
}

fn httpGet(allocator: Allocator, io: std.Io, url: []const u8, headers: fixture_archive.Headers) ![]u8 {
    var client: std.http.Client = .{ .allocator = allocator, .io = io };
    defer client.deinit();
    var req = try client.request(.GET, try std.Uri.parse(url), .{
        .extra_headers = headers,
        .headers = .{ .accept_encoding = .{ .override = "gzip" } },
    });
    defer req.deinit();
    try req.sendBodiless();
    var redirect_buffer: [8 * 1024]u8 = undefined;
    var response = try req.receiveHead(&redirect_buffer);
    if (response.head.status == .unauthorized) {
        std.log.err("GITHUB_TOKEN is invalid or expired", .{});
        return error.Unauthorized;
    }
    if (response.head.status.class() != .success) {
        std.log.err("GitHub API {d} ({s})", .{ @intFromEnum(response.head.status), url });
        return error.GitHubApiFailed;
    }
    var transfer_buffer: [64 * 1024]u8 = undefined;
    var decompress: std.http.Decompress = undefined;
    var decompress_buffer: [std.compress.flate.max_window_len]u8 = undefined;
    const body = response.readerDecompressing(&transfer_buffer, &decompress, &decompress_buffer);
    return body.allocRemaining(allocator, .limited(max_api_response_bytes)) catch |err| switch (err) {
        error.ReadFailed => return response.bodyErr() orelse err,
        else => return err,
    };
}
