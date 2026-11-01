const std = @import("std");
const spec_test_options = @import("spec_test_options");
const download_spec_tests = @import("download_spec_tests.zig");

pub fn main(init: std.process.Init) !void {
    try download_spec_tests.fetchRelease(
        std.heap.smp_allocator,
        init.io,
        spec_test_options.spec_test_url,
        spec_test_options.spec_test_version,
        "comptests",
        spec_test_options.spec_test_version,
        "comptests",
    );
}
