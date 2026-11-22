const std = @import("std");
const zbench = @import("zbench");

const max_depth = @import("hashing").max_depth;
const Gindex = @import("persistent_merkle_tree").Gindex;

const PathBits = struct {
    gindex: Gindex,
    pub fn run(self: *PathBits, allocator: std.mem.Allocator) void {
        _ = allocator;
        var bits_buf: [max_depth]u1 = undefined;
        const bits = self.gindex.toPathBits(&bits_buf);
        for (bits) |bit| {
            std.mem.doNotOptimizeAway(bit);
        }
    }
};

const Path = struct {
    gindex: Gindex,
    pub fn run(self: *Path, allocator: std.mem.Allocator) void {
        _ = allocator;
        var path = self.gindex.toPath();
        var path_len = self.gindex.pathLen();
        while (path_len > 0) {
            path_len -= 1;
            std.mem.doNotOptimizeAway(path.left());
            path.next();
        }
    }
};

pub fn main(init: std.process.Init) !void {
    const allocator = std.heap.page_allocator;
    const io = init.io;
    var bench = zbench.Benchmark.init(allocator, .{});
    defer bench.deinit();

    const gindex: Gindex = @enumFromInt(0x123456789abcdef0);
    const path_bits = PathBits{ .gindex = gindex };
    try bench.addParam("gindex - path_bits", &path_bits, .{});
    const path = Path{ .gindex = gindex };
    try bench.addParam("gindex - path", &path, .{});

    try bench.run(io, std.Io.File.stdout());
}
