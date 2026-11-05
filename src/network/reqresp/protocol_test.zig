const std = @import("std");
const constants = @import("constants.zig");
const consensus = @import("constants");
const ct = @import("consensus_types");
const preset = @import("preset");
const protocol = @import("protocol.zig");
const policy_fixture = @import("policy_fixture.zig");
const request_policy = @import("request_policy.zig");

const Protocol = protocol.Protocol;

test "protocol ids follow the specification form and round trip" {
    try std.testing.expectEqualStrings("/eth2/beacon_chain/req/status/1/ssz_snappy", Protocol.status_v1.id());
    try std.testing.expectEqualStrings("/eth2/beacon_chain/req/status/2/ssz_snappy", Protocol.status_v2.id());
    try std.testing.expectEqualStrings("/eth2/beacon_chain/req/goodbye/1/ssz_snappy", Protocol.goodbye_v1.id());
    try std.testing.expectEqualStrings("/eth2/beacon_chain/req/ping/1/ssz_snappy", Protocol.ping_v1.id());
    try std.testing.expectEqualStrings("/eth2/beacon_chain/req/metadata/3/ssz_snappy", Protocol.metadata_v3.id());
    try std.testing.expectEqualStrings(
        "/eth2/beacon_chain/req/beacon_blocks_by_range/2/ssz_snappy",
        Protocol.blocks_by_range_v2.id(),
    );
    try std.testing.expectEqualStrings(
        "/eth2/beacon_chain/req/data_column_sidecars_by_root/1/ssz_snappy",
        Protocol.data_column_sidecars_by_root_v1.id(),
    );
    inline for (@typeInfo(Protocol).@"enum".fields) |field| {
        const value: Protocol = @enumFromInt(field.value);
        try std.testing.expectEqual(value, Protocol.fromId(value.id()).?);
        try std.testing.expectEqualStrings(value.id(), protocol.ids[field.value]);
    }
    try std.testing.expect(Protocol.fromId("/eth2/beacon_chain/req/status/3/ssz_snappy") == null);
    try std.testing.expect(Protocol.fromId("/eth2/beacon_chain/req/status/1/ssz") == null);
    try std.testing.expect(Protocol.fromId("/eth2/beacon_chain/req/beacon_blocks_by_range/1/ssz_snappy") == null);
    try std.testing.expect(Protocol.fromId("") == null);
}

test "protocol info sizes follow the consensus types" {
    const status = Protocol.status_v1.info();
    try std.testing.expectEqual(@as(usize, 84), status.request_min);
    try std.testing.expectEqual(@as(usize, 84), status.response_max);
    try std.testing.expect(!status.context_bytes);
    try std.testing.expectEqual(@as(u32, 1), status.chunks_max);
    try std.testing.expectEqual(@as(usize, 92), Protocol.status_v2.info().request_max);
    try std.testing.expectEqual(@as(usize, 0), Protocol.metadata_v2.info().request_max);
    try std.testing.expectEqual(@as(usize, 17), Protocol.metadata_v2.info().response_max);
    try std.testing.expectEqual(@as(usize, 25), Protocol.metadata_v3.info().response_max);

    const blocks = Protocol.blocks_by_range_v2.info();
    try std.testing.expectEqual(@as(usize, 24), blocks.request_max);
    try std.testing.expectEqual(constants.MAX_PAYLOAD_SIZE, blocks.response_max);
    try std.testing.expectEqual(ct.phase0.SignedBeaconBlock.min_size, blocks.response_min);
    try std.testing.expect(blocks.context_bytes);
    try std.testing.expectEqual(@as(u32, consensus.MAX_REQUEST_BLOCKS), blocks.chunks_max);
    try std.testing.expectEqual(ct.phase0.BeaconBlockRoots.max_size, Protocol.blocks_by_root_v2.info().request_max);
    try std.testing.expectEqual(ct.deneb.BlobSidecar.fixed_size, Protocol.blob_sidecars_by_root_v1.info().response_min);
    try std.testing.expectEqual(@as(u32, preset.MAX_REQUEST_DATA_COLUMN_SIDECARS), Protocol.data_column_sidecars_by_range_v1.info().chunks_max);
    try std.testing.expectEqual(protocol.requestMaxAll(), Protocol.blob_sidecars_by_root_v1.info().request_max);
}

test "reqresp active head request bounds count before admission" {
    var bytes = [_]u8{0} ** 40;
    try std.testing.expectError(error.InvalidRequest, chunkLimit(.blocks_by_head_v1, &bytes));
    for ([_]u64{ 1, 128, 129, std.math.maxInt(u64) }) |count| {
        std.mem.writeInt(u64, bytes[32..40], count, .little);
        try std.testing.expectEqual(@as(u32, @intCast(@min(count, 128))), try chunkLimit(.blocks_by_head_v1, &bytes));
    }
    try std.testing.expectError(error.InvalidRequest, chunkLimit(.blocks_by_head_v1, bytes[0..39]));
    try std.testing.expectError(error.InvalidRequest, chunkLimit(.blocks_by_head_v1, &([_]u8{0} ** 41)));
}

test "reqresp active light client range allows an exact empty stream" {
    var bytes = [_]u8{0} ** 16;
    for ([_]u64{ 0, 1, 128, 129, std.math.maxInt(u64) }) |count| {
        std.mem.writeInt(u64, bytes[8..16], count, .little);
        try std.testing.expectEqual(@as(u32, @intCast(@min(count, 128))), try chunkLimit(.light_client_updates_by_range_v1, &bytes));
    }
    std.mem.writeInt(u64, bytes[0..8], std.math.maxInt(u64), .little);
    std.mem.writeInt(u64, bytes[8..16], 1, .little);
    try std.testing.expectError(error.InvalidRequest, chunkLimit(.light_client_updates_by_range_v1, &bytes));
    try std.testing.expectError(error.InvalidRequest, chunkLimit(.light_client_updates_by_range_v1, bytes[0..15]));
    try std.testing.expectError(error.InvalidRequest, chunkLimit(.light_client_updates_by_range_v1, &([_]u8{0} ** 17)));
}

test "reqresp active literal ids shapes and application partition" {
    const cases = .{
        .{ Protocol.blocks_by_head_v1, "/eth2/beacon_chain/req/beacon_blocks_by_head/1/ssz_snappy", 40 },
        .{ Protocol.light_client_bootstrap_v1, "/eth2/beacon_chain/req/light_client_bootstrap/1/ssz_snappy", 32 },
        .{ Protocol.light_client_updates_by_range_v1, "/eth2/beacon_chain/req/light_client_updates_by_range/1/ssz_snappy", 16 },
        .{ Protocol.light_client_finality_update_v1, "/eth2/beacon_chain/req/light_client_finality_update/1/ssz_snappy", 0 },
        .{ Protocol.light_client_optimistic_update_v1, "/eth2/beacon_chain/req/light_client_optimistic_update/1/ssz_snappy", 0 },
    };
    inline for (cases) |case| {
        const which = case[0];
        try std.testing.expectEqualStrings(case[1], which.id());
        try std.testing.expectEqual(which, Protocol.fromId(case[1]).?);
        try std.testing.expect(!which.isControl());
        try std.testing.expect(which.info().context_bytes);
        try std.testing.expectEqual(@as(usize, case[2]), which.info().request_min);
        try std.testing.expectEqual(@as(usize, case[2]), which.info().request_max);
        if (case[2] == 0) {
            try std.testing.expectEqual(@as(u32, 1), try chunkLimit(which, ""));
            try std.testing.expectError(error.InvalidRequest, chunkLimit(which, "\x00"));
        }
    }
}

fn chunkLimit(which: Protocol, bytes: []const u8) error{InvalidRequest}!u32 {
    const policy = request_policy.Policy.init(&policy_fixture.config()) catch unreachable;
    return (policy.inspect(which, bytes, .fulu) catch return error.InvalidRequest).chunks_max;
}
