const std = @import("std");
const ssz = @import("ssz");
const hex = @import("hex");
const Node = @import("persistent_merkle_tree").Node;
const Allocator = std.mem.Allocator;

fn unwrapData(json: std.json.Value) std.json.Value {
    return if (json == .object) json.object.get("data") orelse json else json;
}

fn numberString(json: std.json.Value) ![]const u8 {
    return switch (json) {
        .string, .number_string => |value| value,
        else => error.InvalidFixtureNumber,
    };
}

/// Decoders take a deinitializable `out`. A compatible union has no default value, so start from its
/// first option; decoding replaces it.
fn initialValue(comptime ST: type) ST.Type {
    if (comptime ST.kind != .compatible_union) return ST.default_value;
    const option = ST._union_options[0];
    return @unionInit(ST.Type, std.fmt.comptimePrint("option_{d}", .{option.@"0"}), option.@"1".default_value);
}

/// Read the fixture's independent value representation without decoding its SSZ
/// bytes. parse_numbers=false is required: uint256 fixtures exceed f64 and i64.
fn parseValue(comptime ST: type, fixture_allocator: Allocator, json: std.json.Value, out: *ST.Type) !void {
    if (comptime ssz.isBitListType(ST) or ssz.isProgressiveBitListType(ST) or ssz.isBitVectorType(ST)) {
        const values = unwrapData(json).array.items;
        out.* = ST.default_value;
        if (comptime ssz.isBitVectorType(ST)) {
            try std.testing.expectEqual(ST.length, values.len);
            for (values, 0..) |value, i| try out.set(i, value.bool);
        } else {
            try out.resize(fixture_allocator, values.len);
            for (values, 0..) |value, i| try out.set(fixture_allocator, i, value.bool);
        }
    } else if (comptime ssz.isByteVectorType(ST) or ssz.isByteListType(ST) or ssz.isProgressiveByteListType(ST)) {
        const encoded = unwrapData(json).string;
        const bytes = try decodeHex(fixture_allocator, encoded);
        if (comptime ssz.isByteVectorType(ST)) {
            try std.testing.expectEqual(ST.fixed_size, bytes.len);
            out.* = bytes[0..ST.fixed_size].*;
        } else {
            out.* = ST.default_value;
            try out.appendSlice(fixture_allocator, bytes);
        }
    } else switch (ST.kind) {
        .bool => out.* = json.bool,
        .uint => out.* = try std.fmt.parseInt(ST.Type, try numberString(json), 10),
        .container, .progressive_container => {
            inline for (ST.fields) |field| {
                try parseValue(field.type, fixture_allocator, json.object.get(field.name).?, &@field(out, field.name));
            }
        },
        .list, .progressive_list => {
            const values = unwrapData(json).array.items;
            out.* = ST.default_value;
            try out.resize(fixture_allocator, values.len);
            for (values, 0..) |value, i| try parseValue(ST.Element, fixture_allocator, value, &out.items[i]);
        },
        .vector => {
            const values = unwrapData(json).array.items;
            try std.testing.expectEqual(ST.length, values.len);
            for (values, 0..) |value, i| try parseValue(ST.Element, fixture_allocator, value, &out[i]);
        },
        .compatible_union => {
            const selector = try std.fmt.parseInt(u8, try numberString(json.object.get("selector").?), 10);
            inline for (ST._union_options) |option| {
                if (selector == option.@"0") {
                    const name = comptime std.fmt.comptimePrint("option_{d}", .{option.@"0"});
                    out.* = @unionInit(ST.Type, name, undefined);
                    try parseValue(option.@"1", fixture_allocator, json.object.get("data").?, &@field(out, name));
                    return;
                }
            }
            return error.InvalidFixtureSelector;
        },
        else => @compileError("Unsupported SSZ fixture type"),
    }
}

fn decodeHex(fixture_allocator: Allocator, encoded: []const u8) ![]u8 {
    const result = try fixture_allocator.alloc(u8, hex.hexByteLen(encoded));
    return try hex.hexToBytes(result, encoded);
}

const Fixture = struct {
    value: std.json.Value,
    bytes: []const u8,
    root_hex: []const u8,
    rejected: bool,
};

fn loadFixture(fixture_allocator: Allocator, file: []const u8, test_id: []const u8) !Fixture {
    const content = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, file, fixture_allocator, .limited(16 * 1024 * 1024));
    const parsed = try std.json.parseFromSlice(std.json.Value, fixture_allocator, content, .{ .parse_numbers = false });
    const case = parsed.value.object.get(test_id) orelse return error.MissingTestCase;
    return .{
        .value = case.object.get("value").?,
        .bytes = try decodeHex(fixture_allocator, (case.object.get("rawBytes") orelse case.object.get("serialized").?).string),
        .root_hex = case.object.get("root").?.string,
        .rejected = case.object.contains("rejectionReason"),
    };
}

/// Invalid fixtures carry an empty root, so root parsing stays on the valid path.
fn parseRoot(root_hex: []const u8) ![32]u8 {
    try std.testing.expectEqual(66, root_hex.len);
    return hex.hexToRoot(root_hex[0..66]);
}

fn deserializeFromBytes(comptime ST: type, fixture_allocator: Allocator, bytes: []const u8, out: *ST.Type) !void {
    if (comptime ssz.isFixedType(ST)) return ST.deserializeFromBytes(bytes, out);
    return ST.deserializeFromBytes(fixture_allocator, bytes, out);
}

fn hashTreeRoot(comptime ST: type, fixture_allocator: Allocator, value: *const ST.Type, out: *[32]u8) !void {
    if (comptime ssz.isFixedType(ST)) return ST.hashTreeRoot(value, out);
    return ST.hashTreeRoot(fixture_allocator, value, out);
}

fn serializedHashTreeRoot(comptime ST: type, fixture_allocator: Allocator, bytes: []const u8, out: *[32]u8) !void {
    if (comptime ssz.isFixedType(ST)) return ST.serialized.hashTreeRoot(bytes, out);
    return ST.serialized.hashTreeRoot(fixture_allocator, bytes, out);
}

fn serializedSize(comptime ST: type, value: *const ST.Type) usize {
    return if (comptime ssz.isFixedType(ST)) ST.fixed_size else ST.serializedSize(value);
}

fn treeSerializedSize(comptime ST: type, pool: *Node.Pool, node: Node.Id) !usize {
    if (comptime ssz.isFixedType(ST)) return ST.fixed_size;
    return ST.tree.serializedSize(node, pool);
}

fn treeToValue(comptime ST: type, fixture_allocator: Allocator, pool: *Node.Pool, node: Node.Id, out: *ST.Type) !void {
    if (comptime ssz.isFixedType(ST)) return ST.tree.toValue(node, pool, out);
    return ST.tree.toValue(fixture_allocator, node, pool, out);
}

/// Resource failure must never satisfy an invalid-encoding fixture.
fn expectInvalid(result: anyerror!void) !void {
    if (result) |_| return error.ExpectedInvalidSSZ else |err| switch (err) {
        error.OutOfMemory, error.PoolExhausted, error.RefCountOverflow => return err,
        else => {},
    }
}

/// A fixture marked with rejectionReason must fail validation, value decoding,
/// and tree decoding. Any success is a failure.
fn expectFixtureRejected(comptime ST: type, fixture_allocator: Allocator, pool: *Node.Pool, bytes: []const u8) !void {
    try expectInvalid(ST.serialized.validate(bytes));
    var value = initialValue(ST);
    try expectInvalid(deserializeFromBytes(ST, fixture_allocator, bytes, &value));
    if (ST.tree.deserializeFromBytes(pool, bytes)) |node| {
        pool.unref(node);
        return error.ExpectedInvalidSSZ;
    } else |err| try expectInvalid(@as(anyerror!void, err));
}

/// The fixture's JSON value serializes to exactly the fixture's SSZ bytes.
fn expectValueSerializesTo(comptime ST: type, fixture_allocator: Allocator, value: *const ST.Type, bytes: []const u8) !void {
    try std.testing.expectEqual(bytes.len, serializedSize(ST, value));
    const out = try fixture_allocator.alloc(u8, bytes.len);
    try std.testing.expectEqual(bytes.len, ST.serializeIntoBytes(value, out));
    try std.testing.expectEqualSlices(u8, bytes, out);
}

/// The fixture's SSZ bytes pass validation and decode to the fixture's value.
fn expectBytesDeserializeTo(comptime ST: type, fixture_allocator: Allocator, bytes: []const u8, expected: *const ST.Type) !void {
    try ST.serialized.validate(bytes);
    var actual = initialValue(ST);
    try deserializeFromBytes(ST, fixture_allocator, bytes, &actual);
    try std.testing.expect(ST.equals(expected, &actual));
}

/// Merkleization of the value and of the serialized bytes both match the
/// fixture's root.
fn expectHashTreeRoot(comptime ST: type, fixture_allocator: Allocator, value: *const ST.Type, bytes: []const u8, root: *const [32]u8) !void {
    var actual: [32]u8 = undefined;
    try hashTreeRoot(ST, fixture_allocator, value, &actual);
    try std.testing.expectEqualSlices(u8, root, &actual);
    try serializedHashTreeRoot(ST, fixture_allocator, bytes, &actual);
    try std.testing.expectEqualSlices(u8, root, &actual);
}

/// The tree built from the value and the tree decoded from the bytes both root
/// at the fixture root and round-trip back to the value and bytes. Returns the
/// decoded tree node with one reference owned by the caller.
fn expectTreeRoundTrip(
    comptime ST: type,
    fixture_allocator: Allocator,
    pool: *Node.Pool,
    value: *const ST.Type,
    bytes: []const u8,
    root: *const [32]u8,
) !Node.Id {
    const value_node = try ST.tree.fromValue(pool, value);
    defer pool.unref(value_node);
    try std.testing.expectEqualSlices(u8, root, value_node.getRoot(pool));

    const node = try ST.tree.deserializeFromBytes(pool, bytes);
    errdefer pool.unref(node);
    try std.testing.expectEqualSlices(u8, root, node.getRoot(pool));

    const size = try treeSerializedSize(ST, pool, node);
    try std.testing.expectEqual(bytes.len, size);
    const out = try fixture_allocator.alloc(u8, size);
    try std.testing.expectEqual(bytes.len, try ST.tree.serializeIntoBytes(node, pool, out));
    try std.testing.expectEqualSlices(u8, bytes, out);

    var tree_value = initialValue(ST);
    try treeToValue(ST, fixture_allocator, pool, node, &tree_value);
    try std.testing.expect(ST.equals(value, &tree_value));
    return node;
}

fn expectViewRoundTrip(
    comptime ST: type,
    backing_allocator: Allocator,
    fixture_allocator: Allocator,
    pool: *Node.Pool,
    node: Node.Id,
    bytes: []const u8,
    root: *const [32]u8,
) !void {
    const view = try ST.TreeView.init(backing_allocator, pool, node);
    defer view.deinit();
    try view.commit();
    try std.testing.expectEqualSlices(u8, root, view.getRoot().getRoot(pool));
    if (comptime @hasDecl(ST.TreeView, "serializeIntoBytes")) {
        const out = try fixture_allocator.alloc(u8, bytes.len);
        try std.testing.expectEqual(bytes.len, try view.serializeIntoBytes(out));
        try std.testing.expectEqualSlices(u8, bytes, out);
    }
    const clone = try view.clone(.{});
    defer clone.deinit();
    try clone.commit();
    try std.testing.expectEqualSlices(u8, root, clone.getRoot().getRoot(pool));
}

/// Uses two allocators:
/// - `backing_allocator`: manages the arena, pool and tree view
/// - `fixture_allocator`: the arena allocator which does smaller and more frequent allocations for fixtures
pub fn run(comptime ST: type, backing_allocator: Allocator, file: []const u8, test_id: []const u8) !void {
    try runLayout(ST, backing_allocator, file, test_id);
    // Basic progressive lists can also store their chunks in chunked leaves. That layout has the
    // same root and bytes, so it must pass the same fixtures.
    if (comptime ST.kind == .progressive_list and ssz.isBasicType(ST.Element) and !ST.opts.chunked_leaf) {
        const Chunked = ssz.FixedProgressiveListType(ST.Element, .{ .chunked_leaf = true, .limit = ST.opts.limit });
        try runLayout(Chunked, backing_allocator, file, test_id);
    }
}

fn runLayout(comptime ST: type, backing_allocator: Allocator, file: []const u8, test_id: []const u8) !void {
    var arena = std.heap.ArenaAllocator.init(backing_allocator);
    defer arena.deinit();
    const fixture_allocator = arena.allocator();
    const fixture = try loadFixture(fixture_allocator, file, test_id);

    var pool = try Node.Pool.init(.{ .allocator = backing_allocator, .page_allocator = backing_allocator, .pool_size = 100_000 });
    defer pool.deinit();
    const initial_nodes = pool.getNodesInUse();
    defer std.debug.assert(pool.getNodesInUse() == initial_nodes);

    if (fixture.rejected) {
        try expectFixtureRejected(ST, fixture_allocator, &pool, fixture.bytes);
        return;
    }

    const root = try parseRoot(fixture.root_hex);
    var expected: ST.Type = undefined;
    try parseValue(ST, fixture_allocator, fixture.value, &expected);
    try expectValueSerializesTo(ST, fixture_allocator, &expected, fixture.bytes);
    try expectBytesDeserializeTo(ST, fixture_allocator, fixture.bytes, &expected);
    try expectHashTreeRoot(ST, fixture_allocator, &expected, fixture.bytes, &root);
    const node = try expectTreeRoundTrip(ST, fixture_allocator, &pool, &expected, fixture.bytes, &root);
    defer pool.unref(node);

    // Compatible unions have no tree view.
    if (comptime @hasDecl(ST, "TreeView")) {
        try expectViewRoundTrip(ST, backing_allocator, fixture_allocator, &pool, node, fixture.bytes, &root);
    }
}

test "expectInvalid should preserve resource errors" {
    try expectInvalid(error.InvalidLength);
    try std.testing.expectError(error.OutOfMemory, expectInvalid(error.OutOfMemory));
    try std.testing.expectError(error.PoolExhausted, expectInvalid(error.PoolExhausted));
    try std.testing.expectError(error.RefCountOverflow, expectInvalid(error.RefCountOverflow));
    try std.testing.expectError(error.ExpectedInvalidSSZ, expectInvalid({}));
}
