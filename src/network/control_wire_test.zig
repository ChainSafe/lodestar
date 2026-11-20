const std = @import("std");
const t = @import("local_state.zig");
const w = @import("control_wire.zig");
const status: t.Status = .{
    .fork_digest = .{ 1, 2, 3, 4 },
    .finalized_root = @splat(0x11),
    .finalized_epoch = 0x0807060504030201,
    .head_root = @splat(0x22),
    .head_slot = 0x1817161514131211,
    .earliest_available_slot = 0x2827262524232221,
};
const status_vector = [_]u8{ 1, 2, 3, 4 } ++ [_]u8{0x11} ** 32 ++
    [_]u8{ 1, 2, 3, 4, 5, 6, 7, 8 } ++ [_]u8{0x22} ** 32 ++
    [_]u8{ 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18 } ++
    [_]u8{ 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28 };
test "peer control wire independent exact status v1 v2 vectors and lengths" {
    var out: [93]u8 = @splat(0);
    try std.testing.expectEqual(@as(usize, 84), try w.encodeStatus(.status_v1, &status, &out));
    try std.testing.expectEqualSlices(u8, status_vector[0..84], out[0..84]);
    var v1 = status;
    v1.earliest_available_slot = null;
    try std.testing.expectEqual(v1, try w.decodeStatus(.status_v1, status_vector[0..84]));
    try std.testing.expectEqual(@as(usize, 92), try w.encodeStatus(.status_v2, &status, &out));
    try std.testing.expectEqualSlices(u8, &status_vector, out[0..92]);
    try std.testing.expectEqual(status, try w.decodeStatus(.status_v2, &status_vector));
    for ([_]usize{ 0, 83, 85, 91, 93 }) |len| {
        try std.testing.expectError(error.InvalidLength, w.decodeStatus(.status_v1, out[0..len]));
        try std.testing.expectError(error.InvalidLength, w.decodeStatus(.status_v2, out[0..len]));
    }
    try std.testing.expectError(
        error.BufferTooSmall,
        w.encodeStatus(.status_v2, &status, out[0..91]),
    );
    try std.testing.expectError(error.MissingAvailability, w.encodeStatus(.status_v2, &v1, &out));
}
test "peer control wire independent exact metadata versions and hostile bounds" {
    const metadata: t.Metadata = .{
        .seq_number = 0x0807060504030201,
        .attnets = .{ 0xff, 0, 0, 0, 0, 0, 0, 0x80 },
        .syncnets = 9,
        .custody_group_count = 4,
    };
    const vector = [_]u8{ 1, 2, 3, 4, 5, 6, 7, 8 } ++
        [_]u8{ 0xff, 0, 0, 0, 0, 0, 0, 0x80, 9, 4, 0, 0, 0, 0, 0, 0, 0 };
    var bytes: [26]u8 = @splat(0);
    inline for (.{
        .{ w.Protocol.metadata_v1, 16 },
        .{ w.Protocol.metadata_v2, 17 },
        .{ w.Protocol.metadata_v3, 25 },
    }) |case| {
        const len = try w.encodeMetadata(case[0], &metadata, .{}, &bytes);
        try std.testing.expectEqual(@as(usize, case[1]), len);
        try std.testing.expectEqualSlices(u8, vector[0..case[1]], bytes[0..len]);
        var expected = metadata;
        if (case[1] < 25) expected.custody_group_count = null;
        if (case[1] < 17) expected.syncnets = 0;
        try std.testing.expectEqual(
            expected,
            try w.decodeMetadata(case[0], vector[0..case[1]], .{}),
        );
        try std.testing.expectError(
            error.InvalidLength,
            w.decodeMetadata(case[0], bytes[0 .. len + 1], .{}),
        );
        try std.testing.expectError(
            error.InvalidLength,
            w.decodeMetadata(case[0], bytes[0 .. len - 1], .{}),
        );
    }
    @memcpy(bytes[0..25], &vector);
    bytes[16] = 0x10;
    try std.testing.expectError(
        error.InvalidSyncnets,
        w.decodeMetadata(.metadata_v3, bytes[0..25], .{}),
    );
    bytes[16] = 9;
    bytes[17] = 0;
    var zero_custody = metadata;
    zero_custody.custody_group_count = 0;
    try std.testing.expectEqual(zero_custody, try w.decodeMetadata(.metadata_v3, bytes[0..25], .{}));
    try std.testing.expectError(error.InvalidCustodyCount, w.encodeMetadata(.metadata_v3, &zero_custody, .{}, &bytes));
    bytes[17] = 129;
    try std.testing.expectError(
        error.InvalidCustodyCount,
        w.decodeMetadata(.metadata_v3, bytes[0..25], .{}),
    );
    var bad = metadata;
    bad.syncnets = 0x80;
    try std.testing.expectError(
        error.InvalidSyncnets,
        w.encodeMetadata(.metadata_v1, &bad, .{}, &bytes),
    );
}

test "peer control bounded malformed input sweep preserves fixed scratch" {
    var scratch: [93]u8 = @splat(0xff);
    const fork: t.ForkContext = .{};
    for (0..scratch.len + 1) |len| {
        _ = w.decodeStatus(.status_v1, scratch[0..len]) catch {};
        _ = w.decodeStatus(.status_v2, scratch[0..len]) catch {};
        _ = w.decodeMetadata(.metadata_v1, scratch[0..len], fork) catch {};
        _ = w.decodeMetadata(.metadata_v2, scratch[0..len], fork) catch {};
        _ = w.decodeMetadata(.metadata_v3, scratch[0..len], fork) catch {};
    }
    @memset(&scratch, 0);
    for (0..256) |bits| {
        scratch[16] = @intCast(bits);
        if (bits < 16) {
            const metadata = try w.decodeMetadata(.metadata_v2, scratch[0..17], fork);
            try std.testing.expectEqual(@as(u8, @intCast(bits)), metadata.syncnets);
        } else {
            try std.testing.expectError(
                error.InvalidSyncnets,
                w.decodeMetadata(.metadata_v2, scratch[0..17], fork),
            );
        }
    }
    scratch[16] = 0;
    scratch[17] = @intCast(fork.custody_groups);
    _ = try w.decodeMetadata(.metadata_v3, scratch[0..25], fork);
    scratch[17] += 1;
    try std.testing.expectError(
        error.InvalidCustodyCount,
        w.decodeMetadata(.metadata_v3, scratch[0..25], fork),
    );
    try std.testing.expectError(error.InvalidProtocol, w.decodeStatus(.ping_v1, scratch[0..8]));
}

test "peer control wire selects Status and Metadata versions by fork" {
    var fork: t.ForkContext = .{ .fork = .fulu };
    try std.testing.expectEqual(w.Protocol.status_v2, w.statusProtocol(fork));
    try std.testing.expectEqual(w.Protocol.metadata_v3, w.metadataProtocol(fork));
    fork.fork = .altair;
    try std.testing.expectEqual(w.Protocol.metadata_v2, w.metadataProtocol(fork));
    fork.fork = .phase0;
    try std.testing.expectEqual(w.Protocol.metadata_v1, w.metadataProtocol(fork));
}

test "control wire Ping and Goodbye use independent exact uint64 vectors" {
    const Case = struct { value: u64, bytes: [8]u8 };
    const cases = [_]Case{
        .{ .value = 0, .bytes = @splat(0) },
        .{ .value = 1, .bytes = .{ 1, 0, 0, 0, 0, 0, 0, 0 } },
        .{ .value = 0x0807060504030201, .bytes = .{ 1, 2, 3, 4, 5, 6, 7, 8 } },
        .{ .value = std.math.maxInt(u64), .bytes = @splat(0xff) },
    };
    for (cases) |case| {
        var output: [9]u8 = @splat(0xab);
        try std.testing.expectEqual(@as(usize, 8), try w.encodeScalar(case.value, &output));
        try std.testing.expectEqualSlices(u8, &case.bytes, output[0..8]);
        try std.testing.expectEqual(@as(u8, 0xab), output[8]);
        try std.testing.expectEqual(case.value, try w.decodeScalar(&case.bytes));
        try std.testing.expectError(error.InvalidLength, w.decodeScalar(output[0..7]));
        try std.testing.expectError(error.InvalidLength, w.decodeScalar(&output));
        const before = output;
        try std.testing.expectError(error.BufferTooSmall, w.encodeScalar(case.value, output[0..7]));
        try std.testing.expectEqualSlices(u8, &before, &output);
    }
}
