const std = @import("std");
const pb = @import("../wire/protobuf.zig");
const constants = @import("constants.zig");
const topic = @import("topic.zig");
const receive = @import("receive_pool.zig");
const Cursor = @import("protobuf_cursor.zig").Cursor;

pub const Error = pb.Error || error{ DuplicateField, MissingField, InvalidBoolean, InvalidUtf8, LengthLimit, OccurrenceLimit, MetadataLimit };
pub const Shape = enum { rpc, subscription, message, control, ihave, iwant, graft, prune, idontwant };

pub const RpcCounts = struct {
    subscription: u32 = 0,
    message: u32 = 0,
    control: u32 = 0,
    ihave: u32 = 0,
    iwant: u32 = 0,
    graft: u32 = 0,
    prune: u32 = 0,
    idontwant: u32 = 0,
};

const ids_per_list = constants.max_iwant_ids_per_rpc;
pub const ids_per_rpc = 3 * ids_per_list;
pub const fields_per_rpc = 3 * constants.max_subscriptions_per_rpc + 3 * constants.max_publish_per_rpc + 4 * constants.max_control_per_rpc + ids_per_rpc + 2;
// Payload bytes have a separate Snappy bound. Metadata covers one topic and
// framing per item, plus one maximum ID vector for each control family.
pub const metadata_max = (constants.max_subscriptions_per_rpc + constants.max_publish_per_rpc + constants.max_control_per_rpc) *
    (topic.topic_max_len + 16) + ids_per_rpc * (constants.message_id_length + 2);

comptime {
    std.debug.assert(metadata_max <= constants.GOSSIP_MAX_SIZE);
    std.debug.assert(21 + constants.GOSSIP_MAX_SIZE / receive.page_bytes + topic.topic_max_len <= 1 + 2 * pb.Reader.field_limit);
}

const Value = union(enum) { boolean, integer, topic, payload, id, signed, extension, message: Shape };
const Rule = struct { value: Value, count: u16 = 1 };

fn rule(shape: Shape, field: u32) ?Rule {
    return switch (shape) {
        .rpc => switch (field) {
            1 => .{ .value = .{ .message = .subscription }, .count = constants.max_subscriptions_per_rpc },
            2 => .{ .value = .{ .message = .message }, .count = constants.max_publish_per_rpc },
            3 => .{ .value = .{ .message = .control } },
            else => null,
        },
        .control => switch (field) {
            1...5 => .{ .value = .{ .message = switch (field) {
                1 => .ihave,
                2 => .iwant,
                3 => .graft,
                4 => .prune,
                5 => .idontwant,
                else => unreachable,
            } }, .count = constants.max_control_per_rpc },
            else => null,
        },
        .subscription => switch (field) {
            1 => .{ .value = .boolean },
            2 => .{ .value = .topic },
            else => null,
        },
        .message => switch (field) {
            1, 3, 5, 6 => .{ .value = .signed },
            2 => .{ .value = .payload },
            4 => .{ .value = .topic },
            else => null,
        },
        .ihave => switch (field) {
            1 => .{ .value = .topic },
            2 => .{ .value = .id, .count = ids_per_list },
            else => null,
        },
        .iwant, .idontwant => if (field == 1) .{ .value = .id, .count = ids_per_list } else null,
        .graft => if (field == 1) .{ .value = .topic } else null,
        .prune => switch (field) {
            1 => .{ .value = .topic },
            3 => .{ .value = .integer },
            else => null,
        },
    };
}

fn bodyMax(shape: Shape) usize {
    return switch (shape) {
        .rpc, .message => constants.GOSSIP_MAX_SIZE,
        else => metadata_max,
    };
}

const Entry = struct {
    cursor: Cursor,
    shape: Shape,
    counts: [7]u16 = @splat(0),
    fields: u16 = 0,

    fn finish(self: *const Entry) Error!void {
        const required: u7 = switch (self.shape) {
            .subscription => 1 << 2,
            .message => (1 << 2) | (1 << 4),
            .ihave, .graft, .prune => 1 << 1,
            else => 0,
        };
        for (self.counts, 0..) |count, field| {
            if (required & (@as(u7, 1) << @intCast(field)) != 0 and count == 0) return error.MissingField;
        }
    }
};

const Field = struct {
    value: Value,
    body: ?receive.Range = null,
    metadata: usize,
    cost: usize,
};

fn readField(entry: *Entry, view: *const receive.View) Error!Field {
    if (entry.shape != .rpc and entry.shape != .control and entry.fields == pb.Reader.field_limit) return error.FieldLimit;
    entry.fields += 1;
    const start = entry.cursor.cursor.pos;
    const tag = try entry.cursor.tag(view);
    const definition = rule(entry.shape, tag.field) orelse {
        try entry.cursor.skip(view, tag.wire);
        const bytes = entry.cursor.cursor.pos - start;
        return .{ .value = .extension, .metadata = bytes, .cost = 21 + bytes / receive.page_bytes };
    };
    const scalar = definition.value == .boolean or definition.value == .integer;
    if (tag.wire != (if (scalar) pb.wire_varint else pb.wire_len)) return error.BadWireType;
    if (entry.counts[tag.field] == definition.count) return if (definition.count == 1) error.DuplicateField else error.OccurrenceLimit;
    entry.counts[tag.field] += 1;
    const value = try entry.cursor.varint(view);
    const header = entry.cursor.cursor.pos - start;
    if (scalar) {
        if (definition.value == .boolean and value > 1) return error.InvalidBoolean;
        return .{ .value = definition.value, .metadata = header, .cost = header };
    }
    const maximum = switch (definition.value) {
        .topic => topic.topic_max_len,
        .payload => constants.maxCompressedLen(constants.MAX_PAYLOAD_SIZE),
        .id => constants.message_id_length,
        .signed => metadata_max,
        .message => |shape| bodyMax(shape),
        else => unreachable,
    };
    if (value > maximum or (definition.value == .topic and value == 0) or
        (definition.value == .id and value != constants.message_id_length)) return error.LengthLimit;
    const body = try entry.cursor.range(view, @intCast(value));
    if (definition.value == .topic) {
        var bytes: [topic.topic_max_len]u8 = undefined;
        if (!std.unicode.utf8ValidateSlice(view.materialize(body, &bytes))) return error.InvalidUtf8;
    }
    return .{
        .value = definition.value,
        .body = body,
        .metadata = header + if (definition.value == .message or definition.value == .payload) @as(usize, 0) else body.len,
        .cost = header + 1 + body.len / receive.page_bytes + if (definition.value == .topic) body.len else @as(usize, 0),
    };
}

/// Bound known Ethereum fields and skip opaque extensions within the same budgets.
/// Signed publications remain recognizable for per-message StrictNoSign rejection.
/// Validate the whole immutable frame before dispatching any of its items.
pub const Validator = struct {
    stack: [3]Entry = undefined,
    depth: u2 = 1,
    fields: usize = 0,
    metadata: usize = 0,
    controls: usize = 0,
    ids: usize = 0,
    /// Complete only after advance returns true.
    rpc_counts: RpcCounts = .{},

    pub fn init(shape: Shape, view: *const receive.View) Validator {
        var self: Validator = .{};
        self.stack[0] = .{ .shape = shape, .cursor = .{ .cursor = .{ .page = view.first }, .end = view.len } };
        return self;
    }

    pub fn advance(self: *Validator, view: *const receive.View, budget: *usize) Error!bool {
        if (view.len > bodyMax(self.stack[0].shape)) return error.LengthLimit;
        for (0..2 * fields_per_rpc + self.stack.len) |_| {
            if (self.depth == 0) return true;
            const index = self.depth - 1;
            var entry = self.stack[index];
            if (entry.cursor.cursor.pos == entry.cursor.end) {
                try entry.finish();
                switch (entry.shape) {
                    .rpc => {
                        self.rpc_counts.subscription = entry.counts[1];
                        self.rpc_counts.message = entry.counts[2];
                        self.rpc_counts.control = entry.counts[3];
                    },
                    .control => {
                        self.rpc_counts.ihave = entry.counts[1];
                        self.rpc_counts.iwant = entry.counts[2];
                        self.rpc_counts.graft = entry.counts[3];
                        self.rpc_counts.prune = entry.counts[4];
                        self.rpc_counts.idontwant = entry.counts[5];
                    },
                    else => {},
                }
                self.depth -= 1;
                continue;
            }
            if (budget.* == 0) return false;
            if (self.fields == fields_per_rpc) return error.FieldLimit;
            const field = try readField(&entry, view);
            if (field.cost > budget.*) return false;
            budget.* -= field.cost;
            try self.charge(entry.shape, &field);
            self.stack[index] = entry;
            if (field.value == .message) {
                std.debug.assert(self.depth < self.stack.len);
                const body = field.body.?;
                self.stack[self.depth] = .{ .shape = field.value.message, .cursor = .{ .cursor = body.start, .end = body.start.pos + body.len } };
                self.depth += 1;
            }
        }
        unreachable;
    }

    fn charge(self: *Validator, shape: Shape, field: *const Field) Error!void {
        if (shape == .control and field.value == .message) {
            if (self.controls == constants.max_control_per_rpc) return error.OccurrenceLimit;
            self.controls += 1;
        }
        if (field.value == .id) {
            if (self.ids == ids_per_rpc) return error.OccurrenceLimit;
            self.ids += 1;
        }
        if (field.metadata > metadata_max - self.metadata) return error.MetadataLimit;
        self.metadata += field.metadata;
        self.fields += 1;
    }
};

pub fn validate(shape: Shape, bytes: []const u8) Error!void {
    var view = receive.View.contiguous(bytes);
    var validator = Validator.init(shape, &view);
    var budget: usize = std.math.maxInt(usize);
    const complete = try validator.advance(&view, &budget);
    std.debug.assert(complete);
}

test {
    _ = @import("protobuf_schema_test.zig");
}
