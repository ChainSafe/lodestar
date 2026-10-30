const std = @import("std");
const zbench = @import("zbench");
const hashing = @import("hashing");

pub fn hashOne1(out: *[32]u8, left: *const [32]u8, right: *const [32]u8) void {
    var h = std.crypto.hash.sha2.Sha256.init(.{});
    h.update(left);
    h.update(right);
    h.final(out);
}

fn hashOne2(out: *[32]u8, left: *const [32]u8, right: *const [32]u8) void {
    var in = [_][32]u8{ left.*, right.* };
    hashing.hash(@ptrCast(out), &in) catch unreachable;
}

const HashOne_1 = struct {
    obj1: *const [32]u8,
    obj2: *const [32]u8,
    out: *[32]u8,

    pub fn run(self: *HashOne_1, allocator: std.mem.Allocator) void {
        _ = allocator;
        hashOne1(self.out, self.obj1, self.obj1);
    }
};

const HashOne_2 = struct {
    obj1: *const [32]u8,
    obj2: *const [32]u8,
    out: *[32]u8,

    pub fn run(self: *HashOne_2, allocator: std.mem.Allocator) void {
        _ = allocator;
        hashOne2(self.out, self.obj1, self.obj2);
    }
};

pub fn main(init: std.process.Init) !void {
    const allocator = std.heap.page_allocator;
    const io = init.io;
    var bench = zbench.Benchmark.init(allocator, .{});
    defer bench.deinit();

    const obj1: [32]u8 = [_]u8{1} ** 32;
    const obj2: [32]u8 = [_]u8{2} ** 32;
    var out: [32]u8 = [_]u8{0} ** 32;

    const hashOne_1 = HashOne_1{ .obj1 = &obj1, .obj2 = &obj2, .out = &out };
    try bench.addParam("hashOne 1", &hashOne_1, .{});
    const hashOne_2 = HashOne_2{ .obj1 = &obj1, .obj2 = &obj2, .out = &out };
    try bench.addParam("hashOne 2", &hashOne_2, .{});

    try bench.run(io, std.Io.File.stdout());
}
