const std = @import("std");
const testing = std.testing;
const determinism = @import("determinism.zig");
const Rule = determinism.Rule;

test "determinism: the node code reads no clock, randomness, thread, I/O or hash map" {
    var violations: u32 = 0;
    inline for (determinism.node_files) |path| {
        const counts = determinism.check(path, @embedFile("../" ++ path), true);
        for (std.enums.values(Rule)) |rule| violations += counts.get(rule);
    }
    try testing.expectEqual(@as(u32, 0), violations);
}

test "determinism: each rule catches its construct and ignores comments, strings and lookalikes" {
    const source =
        \\const std = @import("std");
        \\const s = @import("std");
        \\const BoundedArray = @import("bounded_array").BoundedArray;
        \\const ssz = @import("ssz");
        \\const limits = @import("../limits.zig");
        \\const Frame = @import("FinalityFrame.zig");
        \\const Hash = @import("../testing/Hash.zig");
        \\const other = @import("other.zig");
        \\const outside = @import("../../hex.zig");
        \\const c = @cImport({});
        \\// std.time.milliTimestamp() in a comment is not a call.
        \\const note = "std.time in a string";
        \\fn f(p: *u8, my: anytype) void {
        \\    _ = std.time.milliTimestamp();
        \\    _ = std.Random.DefaultPrng.init(0);
        \\    _ = std.crypto.random.int(u8);
        \\    _ = std.crypto.hash.sha2.Sha256;
        \\    _ = std.Thread.getCurrentId();
        \\    _ = std.Io.Clock;
        \\    _ = std.fs.cwd();
        \\    _ = std.posix.getenv("HOME");
        \\    _ = std.AutoHashMap(u32, u32);
        \\    _ = std.StringHashMapUnmanaged(u32);
        \\    _ = std.AutoArrayHashMapUnmanaged(u32, u32);
        \\    _ = @intFromPtr(p);
        \\    _ = my.std.time;
        \\    _ = std.mem.eql(u8, "a", "b");
        \\}
        \\test {
        \\    _ = @import("chain_state_test.zig");
        \\}
    ;
    const counts = determinism.check("fg/ChainState.zig", source, false);
    const expected = [_]struct { Rule, u32 }{
        .{ .clock, 1 },
        .{ .randomness, 2 },
        .{ .threads, 1 },
        .{ .io, 3 },
        .{ .unordered_iteration, 2 },
        .{ .pointer_value, 1 },
        .{ .c_import, 1 },
        .{ .std_alias, 1 },
        .{ .foreign_import, 1 },
        .{ .testing_import, 1 },
        .{ .unlisted_file, 2 },
    };
    for (expected) |entry| {
        try testing.expectEqual(entry[1], counts.get(entry[0]));
    }
}

test "determinism: only root.zig may import from testing" {
    const source =
        \\pub const Simulator = @import("testing/Simulator.zig");
    ;
    const from_root = determinism.check("root.zig", source, false);
    try testing.expectEqual(@as(u32, 0), from_root.get(.testing_import));
    const from_node = determinism.check("Node.zig", source, false);
    try testing.expectEqual(@as(u32, 1), from_node.get(.testing_import));
}
