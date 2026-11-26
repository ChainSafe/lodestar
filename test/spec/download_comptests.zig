const std = @import("std");
const spec_test_options = @import("spec_test_options");
const fixture_archive = @import("fixture_archive.zig");

pub fn main(init: std.process.Init) !void {
    try fixture_archive.fetch(
        std.heap.smp_allocator,
        init.io,
        spec_test_options.spec_test_url ++ "/releases/download/" ++ spec_test_options.spec_test_version ++ "/comptests.tar.gz",
        spec_test_options.spec_test_out_dir ++ "/" ++ spec_test_options.spec_test_version ++ "/comptests",
    );
}
