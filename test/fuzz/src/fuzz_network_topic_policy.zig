const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const p = @import("network").gossipsub.topic_policy;
const topic = @import("network").gossipsub.topic;
var memory: [2048]u8 = undefined;
var namespace: p.Namespace = undefined;

pub export fn zig_fuzz_init() callconv(.c) void {
    var allocator = std.heap.FixedBufferAllocator.init(&memory);
    var boundary: p.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    for (&boundary.rules, 0..) |*rule, k| {
        const kind: p.Kind = @enumFromInt(k);
        rule.* = .{ .count = kind.countMax(), .ssz_min = 0, .ssz_max = 1024 };
    }
    namespace = p.Namespace.init(allocator.allocator(), &.{boundary}) catch unreachable;
}

pub export fn zig_fuzz_test(buf: [*]const u8, len: usize) callconv(.c) void {
    if (len > 256) return;
    const result = namespace.lookup(buf[0..len]) orelse return;
    std.debug.assert(result.ordinal < 333 and result.rule.ssz_max == 1024);
    const parsed = topic.parse(buf[0..len]).?;
    var canonical: [topic.topic_max_len]u8 = undefined;
    std.debug.assert(std.mem.eql(u8, buf[0..len], topic.build(parsed.digest, parsed.name, &canonical)));
    std.debug.assert(std.mem.eql(u8, buf[0..len], topic.buildCanonical(namespace.topicAt(result.ordinal), &canonical)));
}
