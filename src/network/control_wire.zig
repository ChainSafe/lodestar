const std = @import("std");
const ct = @import("consensus_types");
const t = @import("local_state.zig");
pub const Protocol = @import("reqresp/protocol.zig").Protocol;
pub const status_size_max = 92;
pub const Error = t.ValidationError || error{
    InvalidLength,
    InvalidEncoding,
    InvalidProtocol,
    BufferTooSmall,
};

/// Ping sequence numbers and Goodbye codes use the same fixed SSZ uint64 layout.
pub fn encodeScalar(value: u64, out: []u8) Error!usize {
    if (out.len < 8) return error.BufferTooSmall;
    std.mem.writeInt(u64, out[0..8], value, .little);
    return 8;
}

pub fn decodeScalar(bytes: []const u8) Error!u64 {
    if (bytes.len != 8) return error.InvalidLength;
    return std.mem.readInt(u64, bytes[0..8], .little);
}

pub fn statusProtocol(fork: t.ForkContext) Protocol {
    return if (fork.fork.gte(.fulu)) .status_v2 else .status_v1;
}

pub fn metadataProtocol(fork: t.ForkContext) Protocol {
    return if (fork.fork.gte(.fulu)) .metadata_v3 else if (fork.fork.gte(.altair))
        .metadata_v2
    else
        .metadata_v1;
}

pub fn encodeStatus(protocol: Protocol, status: *const t.Status, out: []u8) Error!usize {
    return switch (protocol) {
        .status_v1 => encodeStatusType(ct.phase0.Status, status, out),
        .status_v2 => encodeStatusType(ct.fulu.StatusV2, status, out),
        else => error.InvalidProtocol,
    };
}

fn encodeStatusType(comptime Schema: type, status: *const t.Status, out: []u8) Error!usize {
    if (out.len < Schema.fixed_size) return error.BufferTooSmall;
    var value: Schema.Type = undefined;
    value.fork_digest = status.fork_digest;
    value.finalized_root = status.finalized_root;
    value.finalized_epoch = status.finalized_epoch;
    value.head_root = status.head_root;
    value.head_slot = status.head_slot;
    if (@hasField(Schema.Type, "earliest_available_slot")) {
        value.earliest_available_slot = status.earliest_available_slot orelse
            return error.MissingAvailability;
    }
    return Schema.serializeIntoBytes(&value, out[0..Schema.fixed_size]);
}

pub fn decodeStatus(protocol: Protocol, bytes: []const u8) Error!t.Status {
    return switch (protocol) {
        .status_v1 => decodeStatusType(ct.phase0.Status, bytes),
        .status_v2 => decodeStatusType(ct.fulu.StatusV2, bytes),
        else => error.InvalidProtocol,
    };
}

fn decodeStatusType(comptime Schema: type, bytes: []const u8) Error!t.Status {
    if (bytes.len != Schema.fixed_size) return error.InvalidLength;
    var value: Schema.Type = undefined;
    Schema.deserializeFromBytes(bytes, &value) catch return error.InvalidEncoding;
    return .{
        .fork_digest = value.fork_digest,
        .finalized_root = value.finalized_root,
        .finalized_epoch = value.finalized_epoch,
        .head_root = value.head_root,
        .head_slot = value.head_slot,
        .earliest_available_slot = if (@hasField(Schema.Type, "earliest_available_slot"))
            value.earliest_available_slot
        else
            null,
    };
}

pub fn encodeMetadata(
    protocol: Protocol,
    metadata: *const t.Metadata,
    fork: t.ForkContext,
    out: []u8,
) Error!usize {
    try t.validateLocalMetadata(metadata, fork);
    return switch (protocol) {
        .metadata_v1 => encodeMetadataType(ct.phase0.MetaDataV1, metadata, out),
        .metadata_v2 => encodeMetadataType(ct.altair.MetaDataV2, metadata, out),
        .metadata_v3 => encodeMetadataType(ct.fulu.MetaDataV3, metadata, out),
        else => error.InvalidProtocol,
    };
}

fn encodeMetadataType(comptime Schema: type, metadata: *const t.Metadata, out: []u8) Error!usize {
    if (out.len < Schema.fixed_size) return error.BufferTooSmall;
    var value: Schema.Type = undefined;
    value.seq_number = metadata.seq_number;
    value.attnets = .{ .data = metadata.attnets };
    if (@hasField(Schema.Type, "syncnets")) value.syncnets = .{ .data = .{metadata.syncnets} };
    if (@hasField(Schema.Type, "custody_group_count")) {
        value.custody_group_count = metadata.custody_group_count orelse
            return error.InvalidCustodyCount;
    }
    return Schema.serializeIntoBytes(&value, out[0..Schema.fixed_size]);
}

pub fn decodeMetadata(protocol: Protocol, bytes: []const u8, fork: t.ForkContext) Error!t.Metadata {
    const metadata = switch (protocol) {
        .metadata_v1 => try decodeMetadataType(ct.phase0.MetaDataV1, bytes),
        .metadata_v2 => try decodeMetadataType(ct.altair.MetaDataV2, bytes),
        .metadata_v3 => try decodeMetadataType(ct.fulu.MetaDataV3, bytes),
        else => return error.InvalidProtocol,
    };
    try t.validateMetadata(&metadata, fork);
    return metadata;
}

fn decodeMetadataType(comptime Schema: type, bytes: []const u8) Error!t.Metadata {
    if (bytes.len != Schema.fixed_size) return error.InvalidLength;
    if (@hasField(Schema.Type, "syncnets")) {
        if (bytes[16] & 0xf0 != 0) return error.InvalidSyncnets;
    }
    var value: Schema.Type = undefined;
    Schema.deserializeFromBytes(bytes, &value) catch return error.InvalidEncoding;
    return .{
        .seq_number = value.seq_number,
        .attnets = value.attnets.data,
        .syncnets = if (@hasField(Schema.Type, "syncnets")) value.syncnets.data[0] else 0,
        .custody_group_count = if (@hasField(Schema.Type, "custody_group_count"))
            value.custody_group_count
        else
            null,
    };
}

test {
    _ = @import("control_wire_test.zig");
}
