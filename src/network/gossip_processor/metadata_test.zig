const std = @import("std");
const metadata = @import("metadata.zig");
const Kind = @import("../gossip_limits.zig").Kind;
const slots = @import("preset").preset.SLOTS_PER_EPOCH;
const extract = metadata.extract;
const eligible = metadata.eligible;

test "gossip metadata bounds offsets and rejects far future retention" {
    const t = std.testing;
    var data: [240]u8 = @splat(0);
    std.mem.writeInt(u64, data[16..24], 9999999, .little);
    const meta = extract(.beacon_attestation, .electra, &data);
    try t.expect(!eligible(&meta, .beacon_attestation, true, 100));
    try t.expect(extract(.beacon_block, .phase0, data[0..100]).slot == null);
    try t.expect(extract(.beacon_block, .phase0, &data).root == null);
    try t.expect(meta.group != null and meta.root != null);
}

test "Deneb single and aggregate metadata retain the full previous epoch" {
    for ([_]Kind{ .beacon_attestation, .beacon_aggregate_and_proof }) |kind| {
        const current = 3 * slots - 1;
        try std.testing.expect(eligible(&.{ .slot = slots }, kind, true, current));
        try std.testing.expect(!eligible(&.{ .slot = slots - 1 }, kind, true, current));
        try std.testing.expect(eligible(&.{ .slot = current }, kind, true, current));
        try std.testing.expect(eligible(&.{ .slot = current + 1 }, kind, true, current));
        try std.testing.expect(!eligible(&.{ .slot = current + 2 }, kind, true, current));
    }
}

test "attestation metadata preserves past disparity only across the current slot boundary" {
    for ([_]Kind{ .beacon_attestation, .beacon_aggregate_and_proof }) |kind| {
        try std.testing.expect(eligible(&.{ .slot = slots }, kind, true, 3 * slots));
        try std.testing.expect(!eligible(&.{ .slot = slots - 1 }, kind, true, 3 * slots));
        try std.testing.expect(!eligible(&.{ .slot = slots }, kind, true, 3 * slots + 1));
        try std.testing.expect(eligible(&.{ .slot = 2 * slots }, kind, true, 3 * slots + 1));
        try std.testing.expect(eligible(&.{ .slot = 31 }, kind, false, 64));
        try std.testing.expect(!eligible(&.{ .slot = 30 }, kind, false, 64));
        try std.testing.expect(!eligible(&.{ .slot = 31 }, kind, false, 65));
        try std.testing.expect(eligible(&.{ .slot = 32 }, kind, false, 65));
    }
    try std.testing.expect(!eligible(&.{ .slot = 31 }, .beacon_block, true, 64));
}

test "attestation metadata slot bounds saturate at genesis and u64 maximum" {
    for ([_]Kind{ .beacon_attestation, .beacon_aggregate_and_proof }) |kind| {
        for ([_]bool{ false, true }) |deneb| {
            try std.testing.expect(eligible(&.{ .slot = 0 }, kind, deneb, 0));
            try std.testing.expect(eligible(&.{ .slot = 1 }, kind, deneb, 0));
            try std.testing.expect(!eligible(&.{ .slot = 2 }, kind, deneb, 0));
            try std.testing.expect(eligible(&.{ .slot = std.math.maxInt(u64) }, kind, deneb, std.math.maxInt(u64)));
            try std.testing.expect(eligible(&.{}, kind, deneb, 0));
        }
    }
}

test "Gloas metadata follows serialized consensus types and separates payload dependencies" {
    const ct = @import("consensus_types");
    const cases = .{
        .{ Kind.beacon_block, ct.gloas.SignedBeaconBlock },
        .{ Kind.beacon_attestation, ct.gloas.SingleAttestation },
        .{ Kind.beacon_aggregate_and_proof, ct.gloas.SignedAggregateAndProof },
        .{ Kind.execution_payload, ct.gloas.SignedExecutionPayloadEnvelope },
        .{ Kind.execution_payload_bid, ct.gloas.SignedExecutionPayloadBid },
        .{ Kind.data_column_sidecar, ct.gloas.DataColumnSidecar },
        .{ Kind.payload_attestation_message, ct.gloas.PayloadAttestationMessage },
    };
    inline for (cases) |case| {
        const kind = case[0];
        const T = case[1];
        var value = T.default_value;
        defer if (kind == .beacon_block) value.message.body.proposer_slashings.deinit(std.testing.allocator);
        switch (kind) {
            .beacon_block => {
                try value.message.body.proposer_slashings.append(std.testing.allocator, ct.phase0.ProposerSlashing.default_value);
                value.message.slot = 19;
                value.message.parent_root = @splat(5);
                value.message.body.signed_execution_payload_bid.message.parent_block_hash = @splat(7);
            },
            .beacon_attestation => {
                value.data.slot = 19;
                value.data.index = 1;
                value.data.beacon_block_root = @splat(5);
            },
            .beacon_aggregate_and_proof => {
                value.message.aggregate.data.slot = 19;
                value.message.aggregate.data.index = 1;
                value.message.aggregate.data.beacon_block_root = @splat(5);
            },
            .execution_payload => {
                value.message.payload.slot_number = 19;
                value.message.beacon_block_root = @splat(5);
            },
            .execution_payload_bid => {
                value.message.slot = 19;
                value.message.parent_block_root = @splat(5);
                value.message.parent_block_hash = @splat(7);
            },
            .data_column_sidecar => {
                value.slot = 19;
                value.beacon_block_root = @splat(5);
            },
            .payload_attestation_message => {
                value.data.slot = 19;
                value.data.beacon_block_root = @splat(5);
                value.data.payload_present = true;
            },
            else => unreachable,
        }
        var storage: [8192]u8 = undefined;
        const bytes = storage[0..T.serializeIntoBytes(&value, &storage)];
        const result = extract(kind, .gloas, bytes);
        try std.testing.expectEqual(@as(?u64, 19), result.slot);
        try std.testing.expectEqual(@as([32]u8, @splat(5)), result.root.?);
        if (kind == .beacon_block or kind == .execution_payload_bid)
            try std.testing.expectEqual(@as([32]u8, @splat(7)), result.parent_hash.?);
        if (kind == .beacon_attestation or kind == .beacon_aggregate_and_proof or kind == .payload_attestation_message)
            try std.testing.expect(result.payload_present);
        for (0..bytes.len) |length| _ = extract(kind, .gloas, bytes[0..length]);
    }
}

test "memory_safety: Gloas metadata bounds hostile offsets and retains future proposer preferences" {
    var data: [2048]u8 = undefined;
    var random = std.Random.DefaultPrng.init(34);
    for (0..2048) |length| {
        random.random().bytes(&data);
        inline for (std.enums.values(Kind)) |kind| _ = extract(kind, .gloas, data[0..length]);
    }
    @memset(&data, 0xff);
    std.mem.writeInt(u32, data[0..4], 100, .little);
    std.mem.writeInt(u32, data[180..184], 84, .little);
    try std.testing.expectEqual(null, extract(.beacon_block, .gloas, &data).parent_hash);
    const preferences = extract(.proposer_preferences, .gloas, &data);
    try std.testing.expectEqual(null, preferences.slot);
    try std.testing.expect(eligible(&preferences, .proposer_preferences, true, 10));
}
