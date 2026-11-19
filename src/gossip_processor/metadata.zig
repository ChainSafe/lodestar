const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const Kind = @import("limits.zig").Kind;

pub const Metadata = struct {
    slot: ?u64 = null,
    root: ?[32]u8 = null,
    group: ?[128]u8 = null,
    payload_present: bool = false,
    parent_hash: ?[32]u8 = null,
};

pub fn extract(kind: Kind, fork: ForkSeq, data: []const u8) Metadata {
    const offset: usize = switch (kind) {
        .beacon_block => 100,
        .beacon_attestation => if (fork.gte(.electra)) 16 else 4,
        .beacon_aggregate_and_proof => 212,
        .data_column_sidecar => if (fork.gte(.gloas)) 16 else 20,
        .execution_payload => 712,
        .payload_attestation_message => 40,
        .execution_payload_bid => 264,
        else => return .{},
    };
    if (data.len < offset + 8) return .{};
    var result: Metadata = .{ .slot = std.mem.readInt(u64, data[offset..][0..8], .little) };
    // Lodestar slot extraction accepts uint32 slots. A missing required slot is returned
    // to the chain as a single ungrouped job so its peer receives the normal reject verdict.
    if (result.slot.? > std.math.maxInt(u32) or
        (kind == .beacon_attestation and fork.gte(.electra) and data.len != 240)) return .{};
    const root_offset: ?usize = switch (kind) {
        .beacon_attestation, .beacon_aggregate_and_proof => offset + 16,
        .beacon_block => 116,
        .execution_payload => 116,
        .payload_attestation_message => 8,
        .execution_payload_bid => 132,
        .data_column_sidecar => if (fork.gte(.gloas)) 24 else null,
        else => null,
    };
    if (root_offset) |at| {
        if (data.len >= at + 32) result.root = data[at..][0..32].*;
    }
    if ((kind == .beacon_attestation or kind == .beacon_aggregate_and_proof) and result.root == null) return .{};
    if (kind == .beacon_attestation and data.len >= offset + 128) result.group = data[offset..][0..128].*;
    if (fork.gte(.gloas)) {
        if ((kind == .beacon_attestation or kind == .beacon_aggregate_and_proof) and data.len >= offset + 16)
            result.payload_present = std.mem.readInt(u64, data[offset + 8 ..][0..8], .little) == 1;
        if (kind == .payload_attestation_message and data.len > 48) result.payload_present = data[48] == 1;
        if (kind == .execution_payload_bid) result.parent_hash = data[100..132].*;
        if (kind == .beacon_block) result.parent_hash = blockParentHash(data);
    }
    return result;
}

fn blockParentHash(data: []const u8) ?[32]u8 {
    const body_start = 184;
    const bid_pointer = 224 + @import("consensus_types").altair.SyncAggregate.fixed_size;
    if (data.len < body_start + bid_pointer + 12) return null;
    if (std.mem.readInt(u32, data[0..4], .little) != 100 or
        std.mem.readInt(u32, data[180..184], .little) != 84) return null;
    const offset: usize = std.mem.readInt(u32, data[body_start + bid_pointer ..][0..4], .little);
    if (offset < bid_pointer + 12 or offset > data.len - body_start) return null;
    const bid = data[body_start + offset ..];
    if (bid.len < 132 or std.mem.readInt(u32, bid[0..4], .little) != 100) return null;
    return bid[100..132].*;
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
