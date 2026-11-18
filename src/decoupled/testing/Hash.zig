//! Simulation-only semantic hashing. This is not a wire codec or canonical SSZ.
const std = @import("std");
const finality_types = @import("../fg/finality_types.zig");
const limits = @import("../limits.zig");
const types = @import("../types.zig");

const Hash = @This();
const Sha256 = std.crypto.hash.sha2.Sha256;
pub const Root = types.Root;

/// Bound compile-time schema expansion; cyclic pointer schemas are unsupported.
const max_schema_depth = 32;

state: Sha256 = Sha256.init(.{}),

pub fn add(self: *Hash, value: anytype) void {
    if (comptime @typeInfo(@TypeOf(value)) == .pointer) {
        self.visit(value, 0, 0);
    } else {
        var local = value;
        self.visit(&local, 0, 0);
    }
}

pub fn finish(self: *Hash) Root {
    return self.state.finalResult();
}

pub fn of(value: anytype) Root {
    var hash: Hash = .{};
    hash.add(value);
    return hash.finish();
}

fn visit(self: *Hash, ptr: anytype, comptime depth: u8, comptime pointer_depth: u8) void {
    if (depth >= max_schema_depth) @compileError("semantic hash schema is too deep");
    switch (@typeInfo(@TypeOf(ptr))) {
        .pointer => |info| {
            if (info.size == .slice) {
                self.visitSlice(ptr, depth, pointer_depth);
            } else if (info.size == .one) {
                if (@typeInfo(info.child) == .pointer) {
                    if (pointer_depth != 0) @compileError("semantic hash permits one pointer dereference");
                    self.visit(ptr.*, depth, 1);
                } else {
                    self.visitValue(ptr, info.child, depth, pointer_depth);
                }
            } else {
                @compileError("semantic hash does not support this pointer kind");
            }
        },
        else => @compileError("semantic hash traversal requires a pointer"),
    }
}

fn visitValue(
    self: *Hash,
    ptr: anytype,
    comptime T: type,
    comptime depth: u8,
    comptime pointer_depth: u8,
) void {
    switch (@typeInfo(T)) {
        .void => self.mark(0x00),
        .bool => {
            self.mark(0x01);
            self.mark(@intFromBool(ptr.*));
        },
        .int => {
            self.mark(0x02);
            self.addInteger(ptr.*);
        },
        .comptime_int => {
            self.mark(0x02);
            self.addInteger(@as(i64, ptr.*));
        },
        .@"enum" => {
            self.mark(0x03);
            self.addInteger(@intFromEnum(ptr.*));
        },
        .optional => self.visitOptional(ptr, depth, pointer_depth),
        .@"union" => self.visitUnion(ptr, T, depth, pointer_depth),
        .@"struct" => self.visitStruct(ptr, T, depth, pointer_depth),
        .array => self.visitArray(ptr, T, depth, pointer_depth),
        .pointer => @compileError("semantic hash pointer value was not borrowed"),
        else => @compileError("semantic hash does not support this type"),
    }
}

fn visitOptional(self: *Hash, ptr: anytype, comptime depth: u8, comptime pointer_depth: u8) void {
    self.mark(0x04);
    if (ptr.*) |*item| {
        self.mark(1);
        self.visit(item, depth + 1, pointer_depth);
    } else self.mark(0);
}

fn visitUnion(
    self: *Hash,
    ptr: anytype,
    comptime T: type,
    comptime depth: u8,
    comptime pointer_depth: u8,
) void {
    const info = @typeInfo(T).@"union";
    if (info.tag_type == null) @compileError("semantic hash requires tagged unions");
    self.mark(0x05);
    const tag = std.meta.activeTag(ptr.*);
    self.schemaText(@tagName(tag));
    switch (ptr.*) {
        inline else => |*item| {
            if (comptime @typeInfo(@TypeOf(item)).pointer.child != void) {
                self.visit(item, depth + 1, pointer_depth);
            }
        },
    }
}

fn visitStruct(
    self: *Hash,
    ptr: anytype,
    comptime T: type,
    comptime depth: u8,
    comptime pointer_depth: u8,
) void {
    const info = @typeInfo(T).@"struct";
    if (comptime isBoundedArray(T)) {
        self.addBoundedArray(ptr, depth, pointer_depth);
        return;
    }
    self.mark(0x06);
    self.addInteger(info.fields.len);
    inline for (info.fields) |field| {
        self.schemaText(field.name);
        if (comptime std.mem.eql(u8, field.name, "finality_participation") and isChainStateShape(T)) {
            self.addPendingParticipation(ptr, depth + 1, pointer_depth);
        } else if (comptime activeCountField(T, field.name)) |count_field| {
            self.addActiveEntries(ptr, count_field, field.name, depth + 1, pointer_depth);
        } else if (comptime field.is_comptime) {
            var local = @field(ptr.*, field.name);
            self.visit(&local, depth + 1, pointer_depth);
        } else {
            self.visit(&@field(ptr.*, field.name), depth + 1, pointer_depth);
        }
    }
}

fn visitArray(
    self: *Hash,
    ptr: anytype,
    comptime T: type,
    comptime depth: u8,
    comptime pointer_depth: u8,
) void {
    const info = @typeInfo(T).array;
    self.mark(0x07);
    self.addInteger(info.len);
    for (&ptr.*) |*item| self.visit(item, depth + 1, pointer_depth);
}

fn visitSlice(self: *Hash, slice: anytype, comptime depth: u8, comptime pointer_depth: u8) void {
    self.mark(0x08);
    self.addInteger(slice.len);
    for (slice) |*item| self.visit(item, depth + 1, pointer_depth);
}

fn addBoundedArray(self: *Hash, ptr: anytype, comptime depth: u8, comptime pointer_depth: u8) void {
    const T = @typeInfo(@TypeOf(ptr)).pointer.child;
    const Buffer = fieldType(T, "buffer");
    const count = ptr.*.count;
    const count_value: usize = @intCast(count);
    const buffer_info = @typeInfo(Buffer).array;
    std.debug.assert(count_value <= buffer_info.len);
    self.mark(0x0a);
    self.addInteger(count);
    const buffer = &ptr.*.buffer;
    for (buffer.*[0..count_value]) |*item| self.visit(item, depth + 1, pointer_depth);
}

/// Hash only the entries a sibling BoundedArray counts; the rest of the array is uninitialized.
fn addActiveEntries(
    self: *Hash,
    ptr: anytype,
    comptime count_field: []const u8,
    comptime array_field: []const u8,
    comptime depth: u8,
    comptime pointer_depth: u8,
) void {
    const counted = &@field(ptr.*, count_field);
    const count: usize = @intCast(counted.*.count);
    const entries = &@field(ptr.*, array_field);
    std.debug.assert(count <= entries.*.len);
    self.mark(0x0c);
    self.addInteger(counted.*.count);
    for (entries.*[0..count]) |*entry| self.visit(entry, depth + 1, pointer_depth);
}

fn addPendingParticipation(
    self: *Hash,
    ptr: anytype,
    comptime depth: u8,
    comptime pointer_depth: u8,
) void {
    const pending = &@field(ptr.*, "pending_finality");
    const count: usize = @intCast(pending.*.count);
    const rows = &@field(ptr.*, "finality_participation");
    self.mark(0x0b);
    self.addInteger(pending.*.count);
    for (pending.*.buffer[0..count]) |*pair| {
        const index: usize = @intCast(pair.*.j);
        std.debug.assert(index < rows.*.len);
        self.visit(&rows.*[index], depth + 1, pointer_depth);
    }
}

fn isBoundedArray(comptime T: type) bool {
    if (@typeInfo(T) != .@"struct" or !@hasField(T, "buffer") or !@hasField(T, "count")) return false;
    return @typeInfo(fieldType(T, "buffer")) == .array and @typeInfo(fieldType(T, "count")) == .int;
}

fn isChainStateShape(comptime T: type) bool {
    if (@typeInfo(T) != .@"struct" or !@hasField(T, "pending_finality")) return false;
    return isBoundedArray(fieldType(T, "pending_finality"));
}

/// The store's summaries follow T; the state source's states follow roots.
fn activeCountField(comptime T: type, comptime name: []const u8) ?[]const u8 {
    if (@typeInfo(T) != .@"struct") return null;
    const pairs = .{ .{ "summaries", "T" }, .{ "states", "roots" } };
    inline for (pairs) |pair| {
        if (std.mem.eql(u8, name, pair[0]) and @hasField(T, pair[1]) and
            @typeInfo(fieldType(T, pair[0])) == .array and isBoundedArray(fieldType(T, pair[1])))
        {
            return pair[1];
        }
    }
    return null;
}

fn fieldType(comptime T: type, comptime name: []const u8) type {
    inline for (@typeInfo(T).@"struct".fields) |field| {
        if (std.mem.eql(u8, field.name, name)) return field.type;
    }
    @compileError("missing reflected field");
}

fn schemaText(self: *Hash, text: []const u8) void {
    self.addInteger(text.len);
    self.state.update(text);
}

fn addInteger(self: *Hash, value: anytype) void {
    switch (@typeInfo(@TypeOf(value))) {
        .int => |int_info| {
            const Unsigned = std.meta.Int(.unsigned, int_info.bits);
            const raw: Unsigned = if (int_info.signedness == .signed) @bitCast(value) else @intCast(value);
            const byte_count: comptime_int = @max(1, (int_info.bits + 7) / 8);
            const Encoded = std.meta.Int(.unsigned, byte_count * 8);
            var bytes: [byte_count]u8 = undefined;
            std.mem.writeInt(Encoded, &bytes, @as(Encoded, raw), .little);
            self.state.update(&bytes);
        },
        .comptime_int => {
            var bytes: [8]u8 = undefined;
            std.mem.writeInt(i64, &bytes, @as(i64, value), .little);
            self.state.update(&bytes);
        },
        else => @compileError("semantic hash integer helper received a non-integer"),
    }
}

fn mark(self: *Hash, value: u8) void {
    var byte = [1]u8{value};
    self.state.update(&byte);
}

pub fn blockRoot(B: *const finality_types.Block) Root {
    std.debug.assert(B.attestations.len <= limits.max_attestations_per_block);
    std.debug.assert(B.ac_payload.votes.len <= limits.max_vote_set);
    std.debug.assert(B.ac_payload.support_votes.len <= limits.max_vote_set);
    var votes: [limits.max_vote_set]types.GoldfishVote = undefined;
    for (B.ac_payload.votes, 0..) |signed, index| votes[index] = signed.vote;
    const input = .{
        .domain = @as([]const u8, "goldilocks-sim-block-v1"),
        .parent = B.parent,
        .slot = B.slot,
        .attestations = B.attestations,
        .votes = votes[0..B.ac_payload.votes.len],
        .support_votes = B.ac_payload.support_votes,
    };
    return of(input);
}

pub fn nodeDigest(node: anytype) Root {
    const NodeType = @typeInfo(@TypeOf(node)).pointer.child;
    comptime {
        if (!@hasField(NodeType, "t") or !@hasField(NodeType, "next_tick") or
            !@hasField(NodeType, "awake") or !@hasField(NodeType, "stopped") or
            !@hasField(NodeType, "fg") or !@hasField(NodeType, "ac") or
            !@hasField(NodeType, "pool") or !@hasField(NodeType, "Lambda") or
            !@hasField(NodeType, "orphans"))
        {
            @compileError("node digest requires the Node state fields");
        }
    }
    var hash: Hash = .{};
    hash.add(.{
        .t = node.t,
        .next_tick = node.next_tick,
        .awake = node.awake,
        .stopped = node.stopped,
        .fg = &node.fg,
        .ac = &node.ac,
        .pool = &node.pool,
        .Lambda = &node.Lambda,
        .orphans = &node.orphans,
    });
    return hash.finish();
}

test {
    _ = @import("hash_test.zig");
}
