const std = @import("std");
const spec_test_options = @import("spec_test_options");
const fixture_archive = @import("fixture_archive.zig");

const out_dir = spec_test_options.spec_test_out_dir;
const consensus_version = spec_test_options.spec_test_version;
const consensus_releases = spec_test_options.spec_test_url ++ "/releases/download/";

/// Written by the nightly downloader to point the TypeScript spec tests at an unreleased
/// consensus-specs run. Downloading the pinned release puts them back on the pin.
const nightly_marker = out_dir ++ "/nightly.txt";

pub fn main(init: std.process.Init) !void {
    const allocator = std.heap.smp_allocator;
    const io = init.io;

    inline for (.{ "general", "minimal", "mainnet" }) |name| {
        try fixture_archive.fetch(
            allocator,
            io,
            consensus_releases ++ consensus_version ++ "/" ++ name ++ ".tar.gz",
            out_dir ++ "/" ++ consensus_version ++ "/" ++ name,
        );
    }
    // Current releases no longer ship the YAML ssz_generic cases.
    try fixture_archive.fetch(
        allocator,
        io,
        consensus_releases ++ spec_test_options.ssz_generic_spec_test_version ++ "/general.tar.gz",
        out_dir ++ "/" ++ spec_test_options.ssz_generic_spec_test_version ++ "/general",
    );
    try fixture_archive.fetch(
        allocator,
        io,
        spec_test_options.bls_spec_test_url ++ "/releases/download/" ++ spec_test_options.bls_spec_test_version ++ "/bls_tests_yaml.tar.gz",
        out_dir ++ "/bls/" ++ spec_test_options.bls_spec_test_version,
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
