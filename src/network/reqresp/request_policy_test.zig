const std = @import("std");
const p = @import("request_policy.zig");
const c = @import("constants");
const preset = @import("preset");
const Protocol = @import("protocol.zig").Protocol;
const consensus_types = @import("consensus_types");
const protocol = @import("protocol.zig");

const fixture = @import("policy_fixture.zig").config;

fn put(bytes: []u8, at: usize, value: u64) void {
    std.mem.writeInt(u64, bytes[at..][0..8], value, .little);
}
fn offset(bytes: []u8, at: usize, value: u32) void {
    std.mem.writeInt(u32, bytes[at..][0..4], value, .little);
}

test "reqresp request admission policy range work" {
    var cfg = fixture();
    cfg.deneb_start_slot = 10;
    const policy = try p.Policy.init(&cfg);
    var bytes = [_]u8{0} ** 40;
    put(&bytes, 8, 1024);
    for ([_]u64{ 0, 1, std.math.maxInt(u64) }) |step| {
        put(&bytes, 16, step);
        const historical = try policy.inspect(.blocks_by_range_v2, bytes[0..24], .fulu);
        try std.testing.expectEqual(@as(u32, 1024), historical.chunks_max);
        try std.testing.expectEqual(@as(u128, 1024), historical.charged_cost);
    }
    for ([_]u64{ 1, 128, 129, std.math.maxInt(u64) }) |count| {
        put(&bytes, 0, 10);
        put(&bytes, 8, count);
        const result = try policy.inspect(.blocks_by_range_v2, bytes[0..24], .fulu);
        try std.testing.expectEqual(@as(u128, count), result.charged_cost);
        try std.testing.expectEqual(@as(u32, @intCast(@min(count, 128))), result.chunks_max);
    }
    put(&bytes, 0, std.math.maxInt(u64));
    put(&bytes, 8, 1);
    try std.testing.expectError(error.InvalidRequest, policy.inspect(.blocks_by_range_v2, bytes[0..24], .fulu));
    put(&bytes, 0, 0);
    put(&bytes, 8, 0);
    for ([_]Protocol{ .blocks_by_range_v2, .data_column_sidecars_by_range_v1 }) |which| {
        offset(&bytes, 16, 20);
        try std.testing.expectError(error.InvalidRequest, policy.inspect(which, bytes[0..which.info().request_min], .fulu));
    }
    const empty = try policy.inspect(.light_client_updates_by_range_v1, bytes[0..16], .fulu);
    try std.testing.expectEqual(@as(u32, 0), empty.chunks_max);
    try std.testing.expectEqual(@as(u128, 1), empty.charged_cost);
    put(&bytes, 32, 129);
    try std.testing.expectEqual(@as(u32, 128), (try policy.inspect(.blocks_by_head_v1, &bytes, .fulu)).chunks_max);
}

test "reqresp request admission policy canonical roots offsets occurrences and capacities" {
    const policy = try p.Policy.init(&fixture());
    var bytes = [_]u8{0} ** (32 * 1025);
    for ([_]Protocol{ .blocks_by_root_v2, .data_column_sidecars_by_root_v1 }) |which| {
        const empty = try policy.inspect(which, &.{}, .fulu);
        try std.testing.expectEqual(@as(u32, 0), empty.chunks_max);
        try std.testing.expectEqual(@as(u128, 1), empty.charged_cost);
        try std.testing.expectError(error.MalformedSsz, policy.inspect(which, bytes[0..1], .fulu));
    }
    try std.testing.expectEqual(@as(u32, 128), (try policy.inspect(.blocks_by_root_v2, bytes[0 .. 32 * 128], .fulu)).chunks_max);
    try std.testing.expectError(error.UnsupportedBounds, policy.inspect(.blocks_by_root_v2, bytes[0 .. 32 * 129], .fulu));
    try std.testing.expectEqual(@as(u32, 1024), (try policy.inspect(.blocks_by_root_v2, bytes[0 .. 32 * 1024], .phase0)).chunks_max);
    try std.testing.expectError(error.MalformedSsz, policy.inspect(.blocks_by_root_v2, bytes[0 .. 32 * 1025], .phase0));
    offset(&bytes, 0, 8);
    offset(&bytes, 4, 60);
    offset(&bytes, 40, 36);
    put(&bytes, 44, std.math.maxInt(u64));
    put(&bytes, 52, std.math.maxInt(u64));
    offset(&bytes, 92, 36);
    const duplicate = try policy.inspect(.data_column_sidecars_by_root_v1, bytes[0..96], .fulu);
    try std.testing.expectEqual(@as(u128, 2), duplicate.charged_cost);
    for ([_]u32{ 0, 1, 6, 100, 0xffff_fffc }) |bad| {
        offset(&bytes, 0, bad);
        try std.testing.expectError(error.MalformedSsz, policy.inspect(.data_column_sidecars_by_root_v1, bytes[0..96], .fulu));
    }
    offset(&bytes, 0, 8);
    for ([_]u32{ 4, 8, 43, 97, 0xffff_ffff }) |bad| {
        offset(&bytes, 4, bad);
        try std.testing.expectError(error.MalformedSsz, policy.inspect(.data_column_sidecars_by_root_v1, bytes[0..96], .fulu));
    }
    offset(&bytes, 4, 60);
    offset(&bytes, 40, 35);
    try std.testing.expectError(error.MalformedSsz, policy.inspect(.data_column_sidecars_by_root_v1, bytes[0..96], .fulu));
    @memset(&bytes, 0);
    put(&bytes, 8, std.math.maxInt(u64));
    offset(&bytes, 16, 20);
    put(&bytes, 20, std.math.maxInt(u64));
    put(&bytes, 28, std.math.maxInt(u64));
    const wide = try policy.inspect(.data_column_sidecars_by_range_v1, bytes[0..36], .fulu);
    try std.testing.expectEqual(@as(u128, std.math.maxInt(u64)) * 2, wide.charged_cost);
    try std.testing.expectEqual(@as(u32, 256), wide.chunks_max);
    try std.testing.expectEqual(@as(u128, 1), (try policy.inspect(.data_column_sidecars_by_range_v1, bytes[0..20], .fulu)).charged_cost);
    try std.testing.expectError(error.MalformedSsz, policy.inspect(.data_column_sidecars_by_range_v1, bytes[0..21], .fulu));
    offset(&bytes, 16, 21);
    try std.testing.expectError(error.MalformedSsz, policy.inspect(.data_column_sidecars_by_range_v1, bytes[0..36], .fulu));
}

test "reqresp request admission policy immutable validation and host integer limits" {
    var cfg = fixture();
    const policy = try p.Policy.init(&cfg);
    var bytes = [_]u8{0} ** 40;
    put(&bytes, 8, 1);
    cfg.number_of_columns -= 1;
    try std.testing.expectError(error.InvalidPolicy, p.Policy.init(&cfg));
    cfg = fixture();
    cfg.column_chunks = 0;
    try std.testing.expectError(error.InvalidPolicy, p.Policy.init(&cfg));
    cfg = fixture();
    cfg.host_integer_max = 9007199254740991;
    const host = try p.Policy.init(&cfg);
    put(&bytes, 0, cfg.host_integer_max.?);
    try std.testing.expectError(error.HostIntegerRange, host.inspect(.light_client_updates_by_range_v1, bytes[0..16], .fulu));
    @memset(&bytes, 0);
    for ([_]Protocol{ .blocks_by_range_v2, .blocks_by_head_v1, .light_client_updates_by_range_v1, .light_client_bootstrap_v1 }) |which| {
        const size = which.info().request_min;
        try std.testing.expectError(error.MalformedSsz, policy.inspect(which, bytes[0 .. size - 1], .fulu));
        if (size < bytes.len) try std.testing.expectError(error.MalformedSsz, policy.inspect(which, bytes[0 .. size + 1], .fulu));
    }
    for ([_]Protocol{ .light_client_finality_update_v1, .light_client_optimistic_update_v1, .metadata_v1, .metadata_v2, .metadata_v3 }) |which| {
        try std.testing.expectEqual(@as(u128, 1), (try policy.inspect(which, &.{}, .fulu)).charged_cost);
        try std.testing.expectError(error.MalformedSsz, policy.inspect(which, bytes[0..1], .fulu));
    }
}

test "reqresp request admission policy configured limits and full preset column boundaries" {
    var cfg = fixture();
    inline for (.{ "blocks_pre_deneb", "blocks_deneb", "column_chunks" }) |field| {
        cfg = fixture();
        @field(cfg, field) = 0;
        try std.testing.expectError(error.InvalidPolicy, p.Policy.init(&cfg));
        @field(cfg, field) = std.math.maxInt(u32);
        try std.testing.expectError(error.InvalidPolicy, p.Policy.init(&cfg));
    }
    cfg = fixture();
    cfg.column_chunks = 1;
    const small = try p.Policy.init(&cfg);
    const policy = try p.Policy.init(&fixture());
    var range = [_]u8{0} ** (20 + 8 * (preset.NUMBER_OF_COLUMNS + 1));
    put(&range, 8, 1);
    offset(&range, 16, 20);
    try std.testing.expectEqual(@as(u32, preset.NUMBER_OF_COLUMNS), (try policy.inspect(.data_column_sidecars_by_range_v1, range[0 .. range.len - 8], .fulu)).chunks_max);
    try std.testing.expectError(error.MalformedSsz, policy.inspect(.data_column_sidecars_by_range_v1, &range, .fulu));
    try std.testing.expectError(error.UnsupportedBounds, small.inspect(.data_column_sidecars_by_range_v1, range[0..36], .fulu));
    const element_size = 36 + 8 * preset.NUMBER_OF_COLUMNS;
    var roots = [_]u8{0} ** ((4 + element_size) * (c.MAX_REQUEST_BLOCKS_DENEB + 1));
    for (0..c.MAX_REQUEST_BLOCKS_DENEB) |i| {
        const start = 4 * c.MAX_REQUEST_BLOCKS_DENEB + i * element_size;
        offset(&roots, i * 4, @intCast(start));
        offset(&roots, start + 32, 36);
    }
    const full = try policy.inspect(.data_column_sidecars_by_root_v1, roots[0 .. (4 + element_size) * c.MAX_REQUEST_BLOCKS_DENEB], .fulu);
    try std.testing.expectEqual(@as(u32, preset.MAX_REQUEST_DATA_COLUMN_SIDECARS), full.chunks_max);
    offset(&roots, 0, 4 * (c.MAX_REQUEST_BLOCKS_DENEB + 1));
    try std.testing.expectError(error.MalformedSsz, policy.inspect(.data_column_sidecars_by_root_v1, &roots, .fulu));
    var empty = [_]u8{0} ** 40;
    offset(&empty, 0, 4);
    offset(&empty, 36, 36);
    try std.testing.expectEqual(@as(u128, 1), (try policy.inspect(.data_column_sidecars_by_root_v1, &empty, .fulu)).charged_cost);
    const maximum = protocol.requestMaxAll();
    try std.testing.expect(maximum >= consensus_types.phase0.BeaconBlockRoots.max_size);
}

test "native Ping and Metadata preserve full u64 sequences under host integer policy" {
    var cfg = fixture();
    cfg.host_integer_max = 9007199254740991;
    const policy = try p.Policy.init(&cfg);
    const wire = @import("../control_wire.zig");
    const peers = @import("../peers/types.zig");
    const fork: peers.ForkContext = .{ .fork = .fulu, .custody_groups = 128 };
    for ([_]u64{ 9007199254740991, 9007199254740992, std.math.maxInt(u64) }) |sequence| {
        var ping: [8]u8 = undefined;
        put(&ping, 0, sequence);
        const inspected = try policy.inspect(.ping_v1, &ping, .fulu);
        try std.testing.expectEqual(@as(u128, 1), inspected.charged_cost);
        try std.testing.expectEqual(@as(u32, 1), inspected.chunks_max);
        const metadata: peers.Metadata = .{ .seq_number = sequence, .custody_group_count = 1 };
        var encoded: [25]u8 = undefined;
        const length = try wire.encodeMetadata(.metadata_v3, &metadata, fork, &encoded);
        try std.testing.expectEqual(sequence, (try wire.decodeMetadata(.metadata_v3, encoded[0..length], fork)).seq_number);
        var range = [_]u8{0} ** 24;
        put(&range, 0, sequence);
        put(&range, 8, 1);
        try std.testing.expectError(error.HostIntegerRange, policy.inspect(.blocks_by_range_v2, &range, .fulu));
    }
}

test "reqresp Gloas payload requests enforce configured roots counts and host integer bounds" {
    var cfg = fixture();
    cfg.payloads = 3;
    cfg.host_integer_max = 9007199254740991;
    const policy = try p.Policy.init(&cfg);
    var bytes: [128]u8 = @splat(0);
    const range: Protocol = .execution_payload_envelopes_by_range_v1;
    const roots: Protocol = .execution_payload_envelopes_by_root_v1;
    try std.testing.expectError(error.InvalidRequest, policy.inspect(range, bytes[0..16], .gloas));
    put(&bytes, 8, 4);
    const result = try policy.inspect(range, bytes[0..16], .gloas);
    try std.testing.expectEqual(@as(u128, 4), result.charged_cost);
    try std.testing.expectEqual(@as(u32, 3), result.chunks_max);
    put(&bytes, 0, cfg.host_integer_max.?);
    try std.testing.expectError(error.HostIntegerRange, policy.inspect(range, bytes[0..16], .gloas));
    try std.testing.expectEqual(@as(u32, 3), (try policy.inspect(roots, bytes[0..96], .gloas)).chunks_max);
    try std.testing.expectError(error.UnsupportedBounds, policy.inspect(roots, &bytes, .gloas));
    try std.testing.expectError(error.MalformedSsz, policy.inspect(roots, bytes[0..31], .gloas));
    try std.testing.expectEqual(@as(u32, 0), (try policy.inspect(roots, &.{}, .gloas)).chunks_max);
    const lists: Protocol = .inclusion_lists_by_indices_v1;
    put(&bytes, 0, cfg.host_integer_max.? + 1);
    try std.testing.expectError(error.HostIntegerRange, policy.inspect(lists, bytes[0..42], .heze));
    put(&bytes, 0, 1);
    const inspected = try policy.inspect(lists, bytes[0..42], .heze);
    try std.testing.expectEqual(@as(u128, 1), inspected.charged_cost);
    try std.testing.expectEqual(@as(u32, 16), inspected.chunks_max);
    try std.testing.expectError(error.MalformedSsz, policy.inspect(lists, bytes[0..41], .heze));
    cfg.payloads = c.MAX_REQUEST_PAYLOADS + 1;
    try std.testing.expectError(error.InvalidPolicy, p.Policy.init(&cfg));
}
