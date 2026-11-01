const std = @import("std");
const spec_test_options = @import("spec_test_options");
const fixture_archive = @import("fixture_archive.zig");

const out_dir = spec_test_options.spec_test_out_dir;
const consensus_version = spec_test_options.spec_test_version;

/// Written by the nightly downloader to point the TypeScript spec tests at an unreleased
/// consensus-specs run. Downloading the pinned release puts them back on the pin.
const nightly_marker = out_dir ++ "/nightly.txt";

pub fn main(init: std.process.Init) !void {
    const allocator = std.heap.smp_allocator;
    const io = init.io;

    for ([_][]const u8{ "general", "minimal", "mainnet" }) |name| {
        try fetchRelease(allocator, io, spec_test_options.spec_test_url, consensus_version, name, consensus_version, name);
    }
    // Current releases no longer ship the YAML ssz_generic cases.
    try fetchRelease(
        allocator,
        io,
        spec_test_options.spec_test_url,
        spec_test_options.ssz_generic_spec_test_version,
        "general",
        spec_test_options.ssz_generic_spec_test_version,
        "general",
    );
    try fetchRelease(
        allocator,
        io,
        spec_test_options.bls_spec_test_url,
        spec_test_options.bls_spec_test_version,
        "bls_tests_yaml",
        "bls",
        spec_test_options.bls_spec_test_version,
    );
    try fixture_archive.fetch(
        allocator,
        io,
        spec_test_options.interchange_spec_test_url ++ "/archive/refs/tags/" ++ spec_test_options.interchange_spec_test_version ++ ".tar.gz",
        out_dir ++ "/interchange/" ++ spec_test_options.interchange_spec_test_version,
    );
    try @import("download_ssz_spec_tests.zig").download(allocator, io);

    std.Io.Dir.cwd().deleteFile(io, nightly_marker) catch |err| switch (err) {
        error.FileNotFound => {},
        else => return err,
    };
}

/// Extracts the `<asset>.tar.gz` release asset of `tag` into `<out_dir>/<dir>/<sub_dir>`.
pub fn fetchRelease(
    allocator: std.mem.Allocator,
    io: std.Io,
    repo_url: []const u8,
    tag: []const u8,
    asset: []const u8,
    dir: []const u8,
    sub_dir: []const u8,
) !void {
    const url = try std.fmt.allocPrint(allocator, "{s}/releases/download/{s}/{s}.tar.gz", .{ repo_url, tag, asset });
    defer allocator.free(url);
    const asset_dir = try std.fs.path.join(allocator, &.{ out_dir, dir, sub_dir });
    defer allocator.free(asset_dir);
    try fixture_archive.fetch(allocator, io, url, asset_dir);
}
