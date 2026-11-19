const std = @import("std");
const ssz = @import("ssz");
const c = @import("constants");
const phase0 = @import("phase0.zig");
const altair = @import("altair.zig");
const deneb = @import("deneb.zig");
const fulu = @import("fulu.zig");

test "req/resp fixed message sizes match the specification" {
    try std.testing.expectEqual(@as(usize, 84), phase0.Status.fixed_size);
    try std.testing.expectEqual(@as(usize, 92), fulu.StatusV2.fixed_size);
    try std.testing.expectEqual(@as(usize, 8), phase0.Goodbye.fixed_size);
    try std.testing.expectEqual(@as(usize, 8), phase0.Ping.fixed_size);
    try std.testing.expectEqual(@as(usize, 16), phase0.MetaDataV1.fixed_size);
    try std.testing.expectEqual(@as(usize, 17), altair.MetaDataV2.fixed_size);
    try std.testing.expectEqual(@as(usize, 25), fulu.MetaDataV3.fixed_size);
    try std.testing.expectEqual(@as(usize, 24), phase0.BeaconBlocksByRangeRequest.fixed_size);
    try std.testing.expectEqual(@as(usize, 16), deneb.BlobSidecarsByRangeRequest.fixed_size);
    try std.testing.expectEqual(@as(usize, 40), deneb.BlobIdentifier.fixed_size);
    try std.testing.expectEqual(@as(usize, 32 * c.MAX_REQUEST_BLOCKS), phase0.BeaconBlockRoots.max_size);
    try std.testing.expectEqual(@as(usize, 32 * c.MAX_REQUEST_BLOCKS_DENEB), deneb.BeaconBlockRootsDeneb.max_size);
    try std.testing.expectEqual(@as(usize, c.MAX_ERROR_MESSAGE_LENGTH), phase0.ErrorMessage.max_size);
    try std.testing.expectEqual(@as(usize, 8 * @import("preset").NUMBER_OF_COLUMNS), fulu.DataColumnIndices.max_size);
    try std.testing.expectEqual(@as(usize, 20), fulu.DataColumnSidecarsByRangeRequest.min_size);
    try std.testing.expectEqual(@as(usize, 20 + 8 * @import("preset").NUMBER_OF_COLUMNS), fulu.DataColumnSidecarsByRangeRequest.max_size);
    try std.testing.expectEqual(@as(usize, 36), fulu.DataColumnsByRootIdentifier.min_size);
}

test "req/resp status round trips through SSZ" {
    const status = phase0.Status.Type{
        .fork_digest = .{ 0xb5, 0x30, 0x3f, 0x2a },
        .finalized_root = [_]u8{0x11} ** 32,
        .finalized_epoch = 7,
        .head_root = [_]u8{0x22} ** 32,
        .head_slot = 250,
    };
    var bytes: [phase0.Status.fixed_size]u8 = undefined;
    try std.testing.expectEqual(bytes.len, phase0.Status.serializeIntoBytes(&status, &bytes));
    var decoded: phase0.Status.Type = undefined;
    try phase0.Status.deserializeFromBytes(&bytes, &decoded);
    try std.testing.expectEqual(status, decoded);
    try std.testing.expectEqual(@as(u8, 0xb5), bytes[0]);
    try std.testing.expectEqual(@as(u8, 7), bytes[36]);
}

test "req/resp metadata v3 round trips through SSZ" {
    var attnets: ssz.BitVectorType(c.ATTESTATION_SUBNET_COUNT).Type = .{ .data = [_]u8{0} ** 8 };
    try attnets.set(3, true);
    var syncnets: ssz.BitVectorType(c.SYNC_COMMITTEE_SUBNET_COUNT).Type = .{ .data = .{0} };
    try syncnets.set(1, true);
    const metadata = fulu.MetaDataV3.Type{
        .seq_number = 9,
        .attnets = attnets,
        .syncnets = syncnets,
        .custody_group_count = 4,
    };
    var bytes: [fulu.MetaDataV3.fixed_size]u8 = undefined;
    try std.testing.expectEqual(bytes.len, fulu.MetaDataV3.serializeIntoBytes(&metadata, &bytes));
    try std.testing.expectEqual(@as(u8, 9), bytes[0]);
    try std.testing.expectEqual(@as(u8, 0x08), bytes[8]);
    try std.testing.expectEqual(@as(u8, 0x02), bytes[16]);
    try std.testing.expectEqual(@as(u8, 4), bytes[17]);
    var decoded: fulu.MetaDataV3.Type = undefined;
    try fulu.MetaDataV3.deserializeFromBytes(&bytes, &decoded);
    try std.testing.expectEqual(metadata, decoded);
}
