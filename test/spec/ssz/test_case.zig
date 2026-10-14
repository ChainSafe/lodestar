const std = @import("std");
const yaml = @import("yaml");
const snappy = @import("snappy").raw;
const hex = @import("hex");
const ssz = @import("ssz");
const Node = @import("persistent_merkle_tree").Node;

const Allocator = std.mem.Allocator;

pub fn parseYaml(comptime ST: type, allocator: Allocator, y: yaml.Yaml, out: *ST.Type) !void {
    if (comptime ssz.isBitVectorType(ST)) {
        const bytes_buf = try allocator.alloc(u8, ST.byte_length + 2);
        const yaml_bytes = try y.parse(allocator, []const u8);
        const bytes = try hex.hexToBytes(bytes_buf, yaml_bytes);
        out.* = ST.Type{ .data = bytes[0..ST.byte_length].* };
        return;
    } else if (comptime ST.kind == .compatible_union) {
        const map = try y.docs.items[0].asMap();

        // Parse selector field
        y.docs.items[0] = map.get("selector").?;
        const selector_str = try y.parse(allocator, []const u8);
        const selector = try std.fmt.parseInt(u8, selector_str, 10);

        // Parse data field based on selector
        y.docs.items[0] = map.get("data").?;
        inline for (ST._union_options) |option| {
            const option_selector = option.@"0";
            if (selector == option_selector) {
                const option_type = option.@"1";
                const field_name = comptime std.fmt.comptimePrint("option_{d}", .{option_selector});

                // Initialize union field and parse in-place to avoid intermediate copy
                out.* = @unionInit(ST.Type, field_name, option_type.default_value);
                try parseYaml(option_type, allocator, y, &@field(out.*, field_name));

                return;
            }
        }
        return error.InvalidSelector;
    } else if (comptime ssz.isBitListType(ST) or ssz.isProgressiveBitListType(ST)) {
        const yaml_bytes = try y.parse(allocator, []const u8);
        const bytes_buf = try allocator.alloc(u8, hex.hexByteLen(yaml_bytes));
        const data = try hex.hexToBytes(bytes_buf, yaml_bytes);
        // we need to find the padding bit to find the bit_len, and then remove it
        // do this manually, otherwise we're testing the deserialization codepath against itself
        const last_byte = data[data.len - 1];

        const last_byte_clz = @clz(last_byte);
        const last_1_index: u3 = @intCast(7 - last_byte_clz);
        const bit_len = (data.len - 1) * 8 + last_1_index;
        data[data.len - 1] ^= @as(u8, 1) << last_1_index;

        var bl = ST.default_value;
        try bl.resize(allocator, bit_len);
        if (bit_len > 0) {
            if (bit_len % 8 == 0) {
                @memcpy(bl.data.items[0 .. data.len - 1], data[0 .. data.len - 1]);
            } else {
                @memcpy(bl.data.items[0..data.len], data);
            }
        }

        out.* = bl;
        return;
    } else if (ST.kind == .container or ST.kind == .progressive_container) {
        const map = try y.docs.items[0].asMap();
        inline for (ST.fields) |field| {
            y.docs.items[0] = map.get(field.name).?;
            try parseYaml(field.type, allocator, y, &@field(out, field.name));
        }
        return;
    } else if (ST.kind == .list or ST.kind == .progressive_list) {
        if (comptime ssz.isByteListType(ST)) {
            const hex_bytes = try y.parse(allocator, []u8);
            const bytes_buf = try allocator.alloc(u8, (hex_bytes.len - 2) / 2);
            const bytes = try hex.hexToBytes(bytes_buf, hex_bytes);
            out.* = ST.Type.empty;
            try out.resize(allocator, bytes.len);
            @memcpy(out.items, bytes);
            return;
        } else if (comptime ssz.isBasicType(ST.Element)) {
            const items = try y.parse(allocator, []ST.Element.Type);
            out.* = ST.Type.empty;
            try out.resize(allocator, items.len);
            @memcpy(out.items, items);
            return;
        } else {
            const list = try y.docs.items[0].asList();
            var l = ST.Type.empty;
            try l.resize(allocator, list.len);
            for (list, 0..) |v, i| {
                y.docs.items[0] = v;
                try parseYaml(ST.Element, allocator, y, &l.items[i]);
            }
            out.* = l;
            return;
        }
    } else if (ST.kind == .vector) {
        if (comptime ssz.isByteVectorType(ST)) {
            const hex_bytes = try y.parse(allocator, []u8);
            const bytes_buf = try allocator.alloc(u8, (hex_bytes.len - 2) / 2);
            const bytes = try hex.hexToBytes(bytes_buf, hex_bytes);
            out.* = bytes[0..ST.fixed_size].*;
            return;
        } else if (comptime ssz.isBasicType(ST.Element)) {
            out.* = try y.parse(allocator, ST.Type);
            return;
        } else {
            const list = try y.docs.items[0].asList();
            for (list, 0..) |v, i| {
                y.docs.items[0] = v;
                try parseYaml(ST.Element, allocator, y, &out[i]);
            }
            return;
        }
    } else {
        out.* = try y.parse(allocator, ST.Type);
        return;
    }
}

pub fn parseYamlToJson(allocator: Allocator, y: yaml.Yaml.Value, writer: anytype) !void {
    switch (y) {
        .empty => return,
        .scalar => |scalar| {
            const isBool = std.mem.eql(u8, scalar, "true") or std.mem.eql(u8, scalar, "false");

            return if (isBool)
                try writer.print("{s}", .{scalar})
            else
                try writer.print("\"{s}\"", .{scalar});
        },
        .list => |list| {
            try writer.beginArray();
            for (list) |elem| {
                try parseYamlToJson(allocator, elem, writer);
            }
            try writer.endArray();
        },
        .map => |map| {
            try writer.beginObject();
            for (map.keys(), map.values()) |key, value| {
                try writer.objectField(key);
                try parseYamlToJson(allocator, value, writer);
            }
            try writer.endObject();
        },
    }
}

pub fn validTestCase(comptime ST: type, gpa: Allocator, path: std.Io.Dir, meta_file_name: []const u8) !void {
    var arena = std.heap.ArenaAllocator.init(gpa);
    defer arena.deinit();
    const allocator = arena.allocator();
    const io = std.testing.io;

    // read expected root

    const meta_bytes = try path.readFileAlloc(io, meta_file_name, allocator, .unlimited);

    const Meta = struct {
        root: []const u8,
    };

    var meta_yaml = yaml.Yaml{ .source = meta_bytes };
    try meta_yaml.load(allocator);
    const meta = try meta_yaml.parse(allocator, Meta);

    const root_expected = try hex.hexToRoot(meta.root[0..66]);

    // read yaml

    const value_bytes = try path.readFileAlloc(io, "value.yaml", allocator, .unlimited);

    var value_yaml = yaml.Yaml{ .source = value_bytes };
    value_yaml.load(allocator) catch |e| {
        value_yaml.parse_errors.renderToStderr(std.testing.io, .{}, .off) catch {};
        return e;
    };

    // read expected json

    var expected_json_aw: std.Io.Writer.Allocating = .init(allocator);
    defer expected_json_aw.deinit();
    var write_stream: std.json.Stringify = .{ .writer = &expected_json_aw.writer };

    try parseYamlToJson(allocator, value_yaml.docs.items[0], &write_stream);

    const expected_json = try expected_json_aw.toOwnedSlice();
    defer allocator.free(expected_json);

    // read expected value

    const value_expected = try allocator.create(ST.Type);
    value_expected.* = if (comptime ST.kind == .compatible_union) undefined else ST.default_value;
    try parseYaml(ST, allocator, value_yaml, value_expected);

    // read expected serialized

    const serialized_snappy_bytes = try path.readFileAlloc(io, "serialized.ssz_snappy", allocator, .unlimited);

    const serialized_buf = try allocator.alloc(u8, try snappy.uncompressedLength(serialized_snappy_bytes));
    const serialized_len = try snappy.uncompress(serialized_snappy_bytes, serialized_buf);
    const serialized_expected = serialized_buf[0..serialized_len];

    // test serialization - value to ssz

    {
        const serialized_actual = try allocator.alloc(
            u8,
            if (comptime ssz.isFixedType(ST)) ST.fixed_size else ST.serializedSize(value_expected),
        );
        const serialized_actual_size = ST.serializeIntoBytes(value_expected, serialized_actual);
        try std.testing.expectEqual(serialized_expected.len, serialized_actual_size);
        try std.testing.expectEqualSlices(u8, serialized_expected, serialized_actual);
    }

    // test deserialization - ssz to value

    {
        try ST.serialized.validate(serialized_expected);

        const value_actual = try allocator.create(ST.Type);
        value_actual.* = if (comptime ST.kind == .compatible_union) undefined else ST.default_value;

        if (comptime ssz.isFixedType(ST)) {
            try ST.deserializeFromBytes(serialized_expected, value_actual);
        } else {
            try ST.deserializeFromBytes(allocator, serialized_expected, value_actual);
        }
        try std.testing.expect(ST.equals(value_expected, value_actual));
    }

    // test serialization - value to json

    {
        var aw_actual: std.Io.Writer.Allocating = .init(allocator);
        defer aw_actual.deinit();
        var write_stream_actual: std.json.Stringify = .{ .writer = &aw_actual.writer };

        if (comptime ssz.isFixedType(ST)) {
            try ST.serializeIntoJson(&write_stream_actual, value_expected);
        } else {
            try ST.serializeIntoJson(allocator, &write_stream_actual, value_expected);
        }

        const serialized_json_actual = try aw_actual.toOwnedSlice();
        defer allocator.free(serialized_json_actual);

        try std.testing.expectEqualSlices(u8, expected_json, serialized_json_actual);
    }

    // test deserialization - json to value
    {
        const value_actual = try allocator.create(ST.Type);
        value_actual.* = if (comptime ST.kind == .compatible_union) undefined else ST.default_value;

        var scanner = std.json.Scanner.initCompleteInput(allocator, expected_json);
        defer scanner.deinit();

        if (comptime ssz.isFixedType(ST)) {
            try ST.deserializeFromJson(&scanner, value_actual);
        } else {
            try ST.deserializeFromJson(allocator, &scanner, value_actual);
        }

        try std.testing.expect(ST.equals(value_expected, value_actual));
    }

    // test merkleization

    var root_actual_oneshot: [32]u8 = undefined;
    if (comptime ssz.isFixedType(ST)) {
        try ST.hashTreeRoot(value_expected, &root_actual_oneshot);
    } else {
        try ST.hashTreeRoot(allocator, value_expected, &root_actual_oneshot);
    }
    try std.testing.expectEqualSlices(u8, &root_expected, &root_actual_oneshot);

    var root_actual_serialized: [32]u8 = undefined;
    if (comptime ssz.isFixedType(ST)) {
        try ST.serialized.hashTreeRoot(serialized_expected, &root_actual_serialized);
    } else {
        try ST.serialized.hashTreeRoot(allocator, serialized_expected, &root_actual_serialized);
    }
    try std.testing.expectEqualSlices(u8, &root_expected, &root_actual_serialized);

    const Hasher = ssz.Hasher(ST);
    var hash_scratch: ssz.HasherData = if (comptime ssz.isBasicType(ST)) undefined else try Hasher.init(allocator);
    var root_actual: [32]u8 = undefined;
    try Hasher.hash(&hash_scratch, value_expected, &root_actual);
    try std.testing.expectEqualSlices(u8, &root_expected, &root_actual);

    var pool = try Node.Pool.init(.{ .page_allocator = gpa, .allocator = gpa, .pool_size = 1_000_000 });
    defer pool.deinit();

    // test conversion between tree and value
    {
        const node = try ST.tree.fromValue(&pool, value_expected);
        defer pool.unref(node);

        try std.testing.expectEqualSlices(u8, &root_expected, node.getRoot(&pool));

        const value_from_tree = try allocator.create(ST.Type);
        value_from_tree.* = if (comptime ST.kind == .compatible_union) undefined else ST.default_value;

        if (comptime ssz.isFixedType(ST)) {
            try ST.tree.toValue(node, &pool, value_from_tree);
        } else {
            try ST.tree.toValue(allocator, node, &pool, value_from_tree);
        }
        try std.testing.expect(ST.equals(value_expected, value_from_tree));
    }

    // test conversion between tree and serialized
    {
        const node = try ST.tree.deserializeFromBytes(&pool, serialized_expected);
        defer pool.unref(node);

        try std.testing.expectEqualSlices(u8, &root_expected, node.getRoot(&pool));

        const serialized_size = if (comptime ssz.isFixedType(ST)) ST.fixed_size else try ST.tree.serializedSize(node, &pool);
        const serialized_from_tree = try allocator.alloc(u8, serialized_size);
        defer allocator.free(serialized_from_tree);
        _ = try ST.tree.serializeIntoBytes(node, &pool, serialized_from_tree);
        try std.testing.expectEqualSlices(u8, serialized_expected, serialized_from_tree);
    }
}

pub fn invalidTestCase(comptime ST: type, gpa: Allocator, path: std.Io.Dir) !void {
    var arena = std.heap.ArenaAllocator.init(gpa);
    defer arena.deinit();
    const allocator = arena.allocator();
    const io = std.testing.io;

    // read expected serialized

    const serialized_snappy_bytes = try path.readFileAlloc(io, "serialized.ssz_snappy", allocator, .unlimited);

    const serialized_buf = try allocator.alloc(u8, try snappy.uncompressedLength(serialized_snappy_bytes));
    const serialized_len = try snappy.uncompress(serialized_snappy_bytes, serialized_buf);
    const serialized_expected = serialized_buf[0..serialized_len];

    // test deserialization

    try std.testing.expectError(error.InvalidSSZ, validate(ST, serialized_expected));

    var value_actual: ST.Type = if (comptime ST.kind == .compatible_union) undefined else ST.default_value;

    try std.testing.expectError(error.InvalidSSZ, deserialize(ST, allocator, serialized_expected, &value_actual));

    var pool = try Node.Pool.init(.{
        .page_allocator = gpa,
        .allocator = gpa,
        .pool_size = 1_000_000,
    });
    defer pool.deinit();

    try std.testing.expectError(error.InvalidSSZ, deserializeTree(ST, &pool, serialized_expected));
}

fn deserializeTree(comptime ST: type, pool: *Node.Pool, serialized: []const u8) !void {
    const node = ST.tree.deserializeFromBytes(pool, serialized) catch |err| switch (@as(anyerror, err)) {
        error.OutOfMemory, error.PoolExhausted, error.RefCountOverflow => return err,
        else => return error.InvalidSSZ,
    };
    defer pool.unref(node);
}

test "tree invalid-case normalization preserves resource errors" {
    var pool = try Node.Pool.init(.{
        .page_allocator = std.testing.allocator,
        .allocator = std.testing.failing_allocator,
        .pool_size = 0,
    });
    defer pool.deinit();

    try std.testing.expectError(error.PoolExhausted, deserializeTree(ssz.BoolType(), &pool, &.{1}));
    try std.testing.expectError(error.InvalidSSZ, deserializeTree(ssz.BoolType(), &pool, &.{2}));
    try std.testing.expectError(
        error.PoolExhausted,
        deserializeTree(ssz.FixedProgressiveListType(ssz.BoolType()), &pool, &.{1}),
    );

    var payload_pool = try Node.Pool.init(.{
        .page_allocator = std.testing.allocator,
        .allocator = std.testing.failing_allocator,
        .pool_size = 1,
    });
    defer payload_pool.deinit();

    const Container = ssz.StructContainerType(struct { value: ssz.BoolType() });
    try std.testing.expectError(error.OutOfMemory, deserializeTree(Container, &payload_pool, &.{1}));
}

// Wrap validate with a single error type
fn validate(comptime ST: type, serialized: []const u8) !void {
    return ST.serialized.validate(serialized) catch error.InvalidSSZ;
}

// Wrap deserializeFromBytes with a single error type
fn deserialize(comptime ST: type, allocator: Allocator, serialized_expected: []const u8, value_actual: anytype) !void {
    if (comptime ssz.isFixedType(ST)) {
        return ST.deserializeFromBytes(serialized_expected, value_actual) catch error.InvalidSSZ;
    } else {
        return ST.deserializeFromBytes(allocator, serialized_expected, value_actual) catch error.InvalidSSZ;
    }
}
