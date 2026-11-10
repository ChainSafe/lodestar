const std = @import("std");
const isFixedType = @import("type_kind.zig").isFixedType;

const hexToBytes = @import("hex").hexToBytes;
const bytesToHex = @import("hex").bytesToHex;

/// Tests that two values of the same type `T` hash to the same root.
pub fn expectEqualRoots(comptime T: type, expected: T.Type, actual: T.Type) !void {
    var expected_buf: [32]u8 = undefined;
    var actual_buf: [32]u8 = undefined;

    try T.hashTreeRoot(&expected, &expected_buf);
    try T.hashTreeRoot(&actual, &actual_buf);

    try std.testing.expectEqualSlices(u8, &expected_buf, &actual_buf);
}

/// Tests that two values of the same type `T` hash to the same root.
///
/// Same as `expectEqualRoots`, except with allocation.
pub fn expectEqualRootsAlloc(comptime T: type, allocator: std.mem.Allocator, expected: T.Type, actual: T.Type) !void {
    var expected_buf: [32]u8 = undefined;
    var actual_buf: [32]u8 = undefined;

    try T.hashTreeRoot(allocator, &expected, &expected_buf);
    try T.hashTreeRoot(allocator, &actual, &actual_buf);

    try std.testing.expectEqualSlices(u8, &expected_buf, &actual_buf);
}

/// Tests that two values of the same type `T` serialize to the same byte array.
pub fn expectEqualSerialized(comptime T: type, expected: T.Type, actual: T.Type) !void {
    var expected_buf: [T.fixed_size]u8 = undefined;
    var actual_buf: [T.fixed_size]u8 = undefined;

    _ = T.serializeIntoBytes(&expected, &expected_buf);
    _ = T.serializeIntoBytes(&actual, &actual_buf);
    try std.testing.expectEqualSlices(u8, &expected_buf, &actual_buf);
}

/// Tests that two values of the same type `T` serialize to the same byte array.
///
/// Same as `expectEqualSerialized`, except with allocation.
pub fn expectEqualSerializedAlloc(comptime T: type, allocator: std.mem.Allocator, expected: T.Type, actual: T.Type) !void {
    const expected_buf = try allocator.alloc(u8, T.serializedSize(&expected));
    defer allocator.free(expected_buf);
    const actual_buf = try allocator.alloc(u8, T.serializedSize(&actual));
    defer allocator.free(actual_buf);

    _ = T.serializeIntoBytes(&expected, expected_buf);
    _ = T.serializeIntoBytes(&actual, actual_buf);
    try std.testing.expectEqualSlices(u8, expected_buf, actual_buf);
}

pub const TypeTestCase = struct {
    id: []const u8,
    serializedHex: []const u8,
    json: []const u8,
    rootHex: []const u8,
};

/// ST: ssz type
pub fn typeTest(comptime ST: type) type {
    const TypeTest = struct {
        pub fn run(allocator: std.mem.Allocator, tc: *const TypeTestCase) !void {
            var serializedMax = [_]u8{0} ** 1024;
            const serialized = serializedMax[0..((tc.serializedHex.len - 2) / 2)];
            _ = try hexToBytes(serialized, tc.serializedHex);

            if (comptime isFixedType(ST)) {
                // deserialize
                var value: ST.Type = undefined;
                try ST.deserializeFromBytes(serialized, &value);

                // serialize
                var out = [_]u8{0} ** ST.fixed_size;
                _ = ST.serializeIntoBytes(&value, &out);
                try std.testing.expectEqualSlices(u8, serialized, &out);

                // hash tree root
                var root = [_]u8{0} ** 32;
                try ST.hashTreeRoot(&value, root[0..]);
                var root_hex = [_]u8{0} ** 66;
                _ = try bytesToHex(&root_hex, &root);
                try std.testing.expectEqualSlices(u8, tc.rootHex, &root_hex);

                // deserialize from json
                var json_value: ST.Type = undefined;
                var scanner = std.json.Scanner.initCompleteInput(allocator, tc.json);
                defer scanner.deinit();

                try ST.deserializeFromJson(&scanner, &json_value);

                // serialize to json
                var aw: std.Io.Writer.Allocating = .init(allocator);
                defer aw.deinit();
                var write_stream: std.json.Stringify = .{ .writer = &aw.writer };

                try ST.serializeIntoJson(&write_stream, &json_value);
                const output = try aw.toOwnedSlice();
                defer allocator.free(output);
                try std.testing.expectEqualSlices(u8, tc.json, output);
            } else {
                // deserialize
                var value = ST.default_value;
                defer ST.deinit(allocator, &value);

                try ST.deserializeFromBytes(allocator, serialized, &value);

                // serialize
                const out = try allocator.alloc(u8, ST.serializedSize(&value));
                defer allocator.free(out);

                _ = ST.serializeIntoBytes(&value, out);
                try std.testing.expectEqualSlices(u8, serialized, out);

                // hash tree root
                var root = [_]u8{0} ** 32;
                try ST.hashTreeRoot(allocator, &value, root[0..]);
                var root_hex = [_]u8{0} ** 66;
                _ = try bytesToHex(&root_hex, &root);
                try std.testing.expectEqualSlices(u8, tc.rootHex, &root_hex);

                // deserialize from json
                var json_value = ST.default_value;
                defer ST.deinit(allocator, &json_value);

                var scanner = std.json.Scanner.initCompleteInput(allocator, tc.json);
                defer scanner.deinit();

                try ST.deserializeFromJson(allocator, &scanner, &json_value);

                // serialize to json
                var aw2: std.Io.Writer.Allocating = .init(allocator);
                defer aw2.deinit();
                var write_stream2: std.json.Stringify = .{ .writer = &aw2.writer };

                try ST.serializeIntoJson(allocator, &write_stream2, &json_value);
                const output2 = try aw2.toOwnedSlice();
                defer allocator.free(output2);
                // sanity check first
                try std.testing.expectEqual(tc.json.len, output2.len);
                try std.testing.expectEqualSlices(u8, tc.json, output2);
            }
        }
    };
    return TypeTest;
}
