const std = @import("std");
const ct = @import("consensus_types");
const ForkTypes = @import("fork_types").ForkTypes;
const ForkSeq = @import("config").ForkSeq;
const Kind = @import("limits.zig").Kind;

pub const AttestationDataBytes = [ct.phase0.AttestationData.fixed_size]u8;

pub const Metadata = struct {
    slot: ?u64 = null,
    root: ?[32]u8 = null,
    group: ?AttestationDataBytes = null,
    payload_present: bool = false,
    parent_hash: ?[32]u8 = null,
};

pub fn extract(kind: Kind, fork: ForkSeq, data: []const u8) Metadata {
    return switch (fork) {
        inline else => |f| extractForFork(f, kind, data),
    };
}

fn extractForFork(comptime fork: ForkSeq, kind: Kind, data: []const u8) Metadata {
    const F = ForkTypes(fork);
    const PayloadTypes = if (fork.gte(.gloas)) F else ct.gloas;
    switch (kind) {
        .beacon_block => return .{
            .slot = readSlot(F.SignedBeaconBlock, .{ .message, .slot }, data) orelse return .{},
            .root = field(F.SignedBeaconBlock, .{ .message, .parent_root }).read(data),
            .parent_hash = if (fork.gte(.gloas)) blockParentHash(F.SignedBeaconBlock, data) else null,
        },
        .beacon_attestation => {
            const T = if (fork.gte(.electra)) F.SingleAttestation else F.Attestation;
            if (fork.gte(.electra) and data.len != T.fixed_size) return .{};
            return attestationMetadata(T, .{.data}, fork, true, data);
        },
        .beacon_aggregate_and_proof => return attestationMetadata(F.SignedAggregateAndProof, .{ .message, .aggregate, .data }, fork, false, data),
        .data_column_sidecar => {
            const T = if (fork.gte(.fulu)) F.DataColumnSidecar else ct.fulu.DataColumnSidecar;
            if (fork.gte(.gloas)) return .{
                .slot = readSlot(T, .{.slot}, data) orelse return .{},
                .root = field(T, .{.beacon_block_root}).read(data),
            };
            return .{ .slot = readSlot(T, .{ .signed_block_header, .message, .slot }, data) };
        },
        .execution_payload => {
            const T = PayloadTypes.SignedExecutionPayloadEnvelope;
            return .{
                .slot = readSlot(T, .{ .message, .payload, .slot_number }, data) orelse return .{},
                .root = field(T, .{ .message, .beacon_block_root }).read(data),
            };
        },
        .payload_attestation_message => {
            const T = PayloadTypes.PayloadAttestationMessage;
            return .{
                .slot = readSlot(T, .{ .data, .slot }, data) orelse return .{},
                .root = field(T, .{ .data, .beacon_block_root }).read(data),
                .payload_present = fork.gte(.gloas) and (field(T, .{ .data, .payload_present }).read(data) orelse false),
            };
        },
        .execution_payload_bid => {
            const T = PayloadTypes.SignedExecutionPayloadBid;
            return .{
                .slot = readSlot(T, .{ .message, .slot }, data) orelse return .{},
                .root = field(T, .{ .message, .parent_block_root }).read(data),
                .parent_hash = if (fork.gte(.gloas)) field(T, .{ .message, .parent_block_hash }).read(data) else null,
            };
        },
        else => return .{},
    }
}

fn attestationMetadata(comptime T: type, comptime path: anytype, comptime fork: ForkSeq, comptime single: bool, data: []const u8) Metadata {
    return .{
        .slot = readSlot(T, path ++ .{.slot}, data) orelse return .{},
        .root = field(T, path ++ .{.beacon_block_root}).read(data) orelse return .{},
        .group = if (single) field(T, path).bytes(data) else null,
        .payload_present = fork.gte(.gloas) and field(T, path ++ .{.index}).read(data) == 1,
    };
}

fn readSlot(comptime T: type, comptime path: anytype, data: []const u8) ?u64 {
    const slot = field(T, path).read(data) orelse return null;
    // The host accepts uint32 slots. Missing slots go to validation as ungrouped jobs.
    return if (slot <= std.math.maxInt(u32)) slot else null;
}

const WireField = struct {
    ssz_type: type,
    offset: usize,

    fn bytes(comptime self: WireField, data: []const u8) ?[self.ssz_type.fixed_size]u8 {
        const end = self.offset + self.ssz_type.fixed_size;
        if (data.len < end) return null;
        return data[self.offset..end].*;
    }

    fn read(comptime self: WireField, data: []const u8) ?self.ssz_type.Type {
        const encoded = self.bytes(data) orelse return null;
        var value: self.ssz_type.Type = undefined;
        self.ssz_type.deserializeFromBytes(&encoded, &value) catch return null;
        return value;
    }
};

/// A container's first variable-size field starts immediately after its fixed section.
/// Later variable-size fields require reading their offsets from the message.
fn field(comptime Root: type, comptime path: anytype) WireField {
    var T = Root;
    var offset: usize = 0;
    for (path) |name| {
        const member: std.meta.FieldEnum(T.Fields) = name;
        const i = T.getFieldIndex(@tagName(member));
        const Child = T.fields[i].type;
        if (@hasDecl(Child, "fixed_size")) {
            offset += T.field_offsets[i];
        } else {
            for (T.fields[0..i]) |prior| {
                if (!@hasDecl(prior.type, "fixed_size"))
                    @compileError(@tagName(member) ++ " requires a runtime SSZ offset");
            }
            offset += T.fixed_end;
        }
        T = Child;
    }
    return .{ .ssz_type = T, .offset = offset };
}

fn blockParentHash(comptime SignedBlock: type, data: []const u8) ?[32]u8 {
    comptime var T = SignedBlock;
    var bytes = data;
    inline for (.{ .message, .body, .signed_execution_payload_bid, .message }) |name| {
        const index = comptime T.getFieldIndex(@tagName(name));
        const ranges = T.readFieldRanges(bytes) catch return null;
        const start, const end = ranges[index];
        bytes = bytes[start..end];
        T = T.fields[index].type;
    }
    return field(T, .{.parent_block_hash}).read(bytes);
}

pub fn eligible(metadata: *const Metadata, kind: Kind, deneb: bool, slot: u64) bool {
    const message_slot = metadata.slot orelse return true;
    const slots = @import("preset").preset.SLOTS_PER_EPOCH;
    const attestation = kind == .beacon_attestation or kind == .beacon_aggregate_and_proof;
    // Slot-only admission retains the previous-slot clock-disparity allowance. The host
    // applies the exact time bound before accepting either form of attestation.
    const earliest_current = if (attestation) slot -| 1 else slot;
    const earliest = if (deneb and attestation) (earliest_current / slots -| 1) * slots else earliest_current -| 32;
    return message_slot >= earliest and message_slot <= slot +| @as(u64, if (kind == .execution_payload_bid) 2 else 1);
}

test {
    _ = @import("metadata_test.zig");
}
