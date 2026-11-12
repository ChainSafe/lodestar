const std = @import("std");
const enr = @import("identity/enr.zig");
const crypto = @import("identity/crypto.zig");
const RoutingTable = @import("RoutingTable.zig");
const types = @import("types.zig");
const test_support = @import("test_support.zig");

const address4 = test_support.address4;
const address6 = test_support.address6;
const fakeRecord = test_support.fakeRecord;

test "known routing contacts seed lookups but require a response for maintenance and relay" {
    const local_id: types.NodeId = @splat(0);
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, local_id);
    defer table.deinit(std.testing.allocator);
    const id = nodeAtDistance(256, 1);
    const address = address4(203, 1, 1, 1, 9000);
    const record = fakeRecord(id, address, 1);
    const peer: types.Endpoint = .{ .node_id = id, .address = address };
    try std.testing.expect(try table.addKnown(&peer, &record));
    try std.testing.expect(!try table.addKnown(&peer, &record));
    try std.testing.expect(table.get(&id).?.last_verified_ms == null);
    var closest: [1]RoutingTable.Entry = undefined;
    try std.testing.expectEqualDeep(peer, table.closest(&id, &closest)[0].peer);
    var cursor: usize = 0;
    try std.testing.expect(table.maintenanceTarget(&cursor, 1000, 1) == null);
    const local = fakeRecord(local_id, address4(203, 2, 1, 1, 9000), 1);
    var records: [1]enr.Record = undefined;
    try std.testing.expectEqual(@as(usize, 0), (try table.findNodes(&local, null, &.{256}, &records)).len);

    _ = try table.upsertVerified(&peer, &record, 0, .outgoing);
    try std.testing.expectEqual(@as(?u64, 0), table.get(&id).?.last_verified_ms);
    try std.testing.expect(!try table.addKnown(&peer, &record));
    try std.testing.expectEqual(@as(?u64, 0), table.get(&id).?.last_verified_ms);
    try std.testing.expectEqual(@as(usize, 1), (try table.findNodes(&local, null, &.{256}, &records)).len);
    try std.testing.expect(table.markUnresponsive(&id, 0));
    try std.testing.expectEqual(@as(usize, 1), table.count());
    try std.testing.expectEqual(@as(usize, 1), table.closest(&id, &closest).len);
    try std.testing.expect(table.maintenanceTarget(&cursor, 1000, 1) == null);
    try std.testing.expectEqual(@as(usize, 0), (try table.findNodes(&local, null, &.{256}, &records)).len);
    _ = try table.upsertVerified(&peer, &record, 1001, .outgoing);
    try std.testing.expectEqual(@as(?u64, 1001), table.get(&id).?.last_verified_ms);
    try std.testing.expect(!table.markUnresponsive(&id, 0));
}

test "known routing contacts obey capacity and precede responsive replacement incumbents" {
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, @splat(0));
    defer table.deinit(std.testing.allocator);
    const responsive = fakeRecord(nodeAtDistance(256, 1), address4(203, 1, 1, 1, 9000), 1);
    _ = try table.upsertVerified(&test_support.endpoint(&responsive), &responsive, 0, .outgoing);
    for (2..RoutingTable.bucket_size + 1) |i| {
        const record = fakeRecord(nodeAtDistance(256, @intCast(i)), address4(203, @intCast(i), 1, 1, 9000), 1);
        try std.testing.expect(try table.addKnown(&test_support.endpoint(&record), &record));
    }
    const candidate = fakeRecord(nodeAtDistance(256, 33), address4(203, 33, 1, 1, 9000), 1);
    try std.testing.expect(!try table.addKnown(&test_support.endpoint(&candidate), &candidate));
    try std.testing.expectEqual(@as(usize, 0), table.pendingCount());
    _ = try table.upsertVerified(&test_support.endpoint(&candidate), &candidate, 1, .outgoing);
    const incumbent = table.revalidationTarget().?;
    try std.testing.expect(incumbent.last_verified_ms == null);
    _ = try table.resolveRevalidation(&incumbent.peer.node_id, false, 2);
    try std.testing.expectEqual(@as(?u64, 0), table.get(&responsive.node_id).?.last_verified_ms);
    try std.testing.expectEqual(@as(?u64, 1), table.get(&candidate.node_id).?.last_verified_ms);
    try std.testing.expectEqual(RoutingTable.bucket_size, table.count());
}

test "known routing contacts consume prefix quotas and cannot replace an authenticated endpoint" {
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, @splat(0));
    defer table.deinit(std.testing.allocator);
    for (1..3) |i| {
        const record = fakeRecord(nodeAtDistance(256, @intCast(i)), address4(203, 1, 1, @intCast(i), 9000), 1);
        try std.testing.expect(try table.addKnown(&test_support.endpoint(&record), &record));
    }
    const rejected = fakeRecord(nodeAtDistance(256, 3), address4(203, 1, 1, 3, 9000), 1);
    try std.testing.expectError(error.AddressLimit, table.addKnown(&test_support.endpoint(&rejected), &rejected));
    const verified = fakeRecord(nodeAtDistance(256, 1), address4(203, 1, 1, 1, 9000), 1);
    _ = try table.upsertVerified(&test_support.endpoint(&verified), &verified, 10, .outgoing);
    const advertised = fakeRecord(verified.node_id, address4(198, 2, 1, 1, 9000), 2);
    try std.testing.expect(!try table.addKnown(&test_support.endpoint(&advertised), &advertised));
    try std.testing.expectEqualDeep(test_support.endpoint(&verified), table.get(&verified.node_id).?.peer);
    try std.testing.expectEqual(@as(u64, 1), table.get(&verified.node_id).?.record.sequence);
    try std.testing.expectEqual(@as(?u64, 10), table.get(&verified.node_id).?.last_verified_ms);
}

test "routing table serves local ENR when either signed endpoint is relay eligible" {
    const private4 = address4(10, 1, 0, 1, 9000);
    const public4 = address4(192, 0, 2, 1, 9000);
    const public6 = address6(.{ 0x20, 0x01, 0x0d, 0xb8 } ++ .{0} ** 11 ++ .{1}, 9000);
    const private6 = address6(.{0xfd} ++ .{0} ** 14 ++ .{1}, 9000);
    const local_id: types.NodeId = @splat(0);
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, local_id);
    defer table.deinit(std.testing.allocator);

    var record = fakeRecord(local_id, private4, 1);
    record.ip6 = public6.ip6.octets;
    record.udp6 = public6.port();
    var out: [1]enr.Record = undefined;
    for ([_]types.Address{ public4, public6, private4 }) |requester| {
        const found = try table.findNodes(&record, requester, &.{0}, &out);
        try std.testing.expectEqual(@as(usize, 1), found.len);
        try std.testing.expectEqualDeep(record, found[0]);
    }
    record.ip6 = private6.ip6.octets;
    for ([_]types.Address{ public4, public6 }) |requester| {
        try std.testing.expectEqual(@as(usize, 0), (try table.findNodes(&record, requester, &.{0}, &out)).len);
    }
    try std.testing.expectEqual(@as(usize, 1), (try table.findNodes(&record, private6, &.{0}, &out)).len);
    record.ip6 = public6.ip6.octets;
    record.udp6 = 0;
    try std.testing.expectEqual(@as(usize, 0), (try table.findNodes(&record, public6, &.{0}, &out)).len);
    record.udp6 = null;
    try std.testing.expectEqual(@as(usize, 1), (try table.findNodes(&record, public6, &.{0}, &out)).len);
    try std.testing.expectEqual(@as(usize, 0), (try table.findNodes(&record, public6, &.{0}, out[0..0])).len);
}

test "routing table revalidates the least recent entry before replacement" {
    const local_id = [_]u8{0} ** 32;
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, local_id);
    defer table.deinit(std.testing.allocator);

    var ids: [RoutingTable.bucket_size + 2]types.NodeId = undefined;
    for (0..RoutingTable.bucket_size) |index| {
        ids[index] = nodeAtDistance(256, @intCast(index + 1));
        const address = address4(10, @intCast(index + 1), 0, 1, @intCast(9_000 + index));
        var record = fakeRecord(ids[index], address, 1);
        const peer = types.Endpoint{ .node_id = ids[index], .address = address };
        try std.testing.expectEqual(
            RoutingTable.PutResult.inserted,
            try table.upsertVerified(&peer, &record, @intCast(index), .outgoing),
        );
    }
    try std.testing.expectEqual(RoutingTable.bucket_size, table.count());

    ids[RoutingTable.bucket_size] = nodeAtDistance(256, 17);
    const candidate_address = address4(10, 17, 0, 1, 9_017);
    var candidate_record = fakeRecord(ids[RoutingTable.bucket_size], candidate_address, 1);
    const candidate_peer = types.Endpoint{
        .node_id = ids[RoutingTable.bucket_size],
        .address = candidate_address,
    };
    const first_pending = try table.upsertVerified(&candidate_peer, &candidate_record, 20, .outgoing);
    try expectPending(first_pending, &ids[0]);
    try std.testing.expectEqual(@as(usize, 1), table.pendingCount());
    const first_target = table.revalidationTarget().?;
    try std.testing.expectEqualSlices(u8, &ids[0], &first_target.peer.node_id);

    var first_record = fakeRecord(ids[0], address4(10, 1, 0, 1, 9_000), 1);
    const first_peer = types.Endpoint{ .node_id = ids[0], .address = first_record.endpoint().? };
    try std.testing.expectEqual(
        RoutingTable.PutResult.refreshed,
        try table.upsertVerified(&first_peer, &first_record, 21, .outgoing),
    );
    try std.testing.expectEqual(@as(usize, 0), table.pendingCount());
    try std.testing.expect(table.revalidationTarget() == null);

    const second_pending = try table.upsertVerified(&candidate_peer, &candidate_record, 22, .outgoing);
    try expectPending(second_pending, &ids[1]);
    ids[RoutingTable.bucket_size + 1] = nodeAtDistance(256, 18);
    const busy_address = address4(10, 18, 0, 1, 9_018);
    var busy_record = fakeRecord(ids[RoutingTable.bucket_size + 1], busy_address, 1);
    const busy_peer = types.Endpoint{
        .node_id = ids[RoutingTable.bucket_size + 1],
        .address = busy_address,
    };
    try std.testing.expectEqual(
        RoutingTable.PutResult.pending_busy,
        try table.upsertVerified(&busy_peer, &busy_record, 23, .outgoing),
    );

    try std.testing.expectEqual(
        RoutingTable.ResolveResult.retained,
        try table.resolveRevalidation(&ids[1], true, 24),
    );
    const third_pending = try table.upsertVerified(&candidate_peer, &candidate_record, 25, .outgoing);
    try expectPending(third_pending, &ids[2]);
    candidate_record.sequence = 2;
    const updated_pending = try table.upsertVerified(&candidate_peer, &candidate_record, 26, .outgoing);
    try expectPending(updated_pending, &ids[2]);
    const resolution = try table.resolveRevalidation(&ids[2], false, 27);
    switch (resolution) {
        .replaced => |node_id| try std.testing.expectEqualSlices(
            u8,
            &ids[RoutingTable.bucket_size],
            &node_id,
        ),
        .retained => return error.TestUnexpectedResult,
    }
    try std.testing.expect(!table.contains(&ids[2]));
    try std.testing.expect(table.contains(&ids[RoutingTable.bucket_size]));
    try std.testing.expectEqual(
        @as(u64, 2),
        table.get(&ids[RoutingTable.bucket_size]).?.record.sequence,
    );
    try std.testing.expectEqual(RoutingTable.bucket_size, table.count());
    try std.testing.expectError(
        error.NoPendingRevalidation,
        table.resolveRevalidation(&ids[2], false, 28),
    );
}

test "routing table enforces bucket and table subnet limits" {
    const local_id = [_]u8{0} ** 32;
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, local_id);
    defer table.deinit(std.testing.allocator);

    for (1..RoutingTable.bucket_subnet_limit + 1) |salt| {
        const node_id = nodeAtDistance(256, @intCast(salt));
        const address = address4(192, 0, 2, @intCast(salt), @intCast(9_000 + salt));
        var record = fakeRecord(node_id, address, 1);
        const peer = types.Endpoint{ .node_id = node_id, .address = address };
        _ = try table.upsertVerified(&peer, &record, 1, .outgoing);
    }
    const rejected_id = nodeAtDistance(256, 3);
    const rejected_address = address4(192, 0, 2, 3, 9_003);
    var rejected_record = fakeRecord(rejected_id, rejected_address, 1);
    const rejected_peer = types.Endpoint{
        .node_id = rejected_id,
        .address = rejected_address,
    };
    try std.testing.expectError(
        error.AddressLimit,
        table.upsertVerified(&rejected_peer, &rejected_record, 1, .outgoing),
    );

    var other_table: RoutingTable = undefined;
    try other_table.init(std.testing.allocator, local_id);
    defer other_table.deinit(std.testing.allocator);
    for (0..RoutingTable.table_subnet_limit) |index| {
        const node_id = nodeAtDistance(@intCast(241 + index), @intCast(index + 1));
        const address = address4(198, 51, 100, @intCast(index + 1), @intCast(10_000 + index));
        var record = fakeRecord(node_id, address, 1);
        const peer = types.Endpoint{ .node_id = node_id, .address = address };
        _ = try other_table.upsertVerified(&peer, &record, 1, .outgoing);
    }
    const table_rejected_id = nodeAtDistance(251, 11);
    const table_rejected_address = address4(198, 51, 100, 11, 10_011);
    var table_rejected_record = fakeRecord(table_rejected_id, table_rejected_address, 1);
    const table_rejected_peer = types.Endpoint{
        .node_id = table_rejected_id,
        .address = table_rejected_address,
    };
    try std.testing.expectError(
        error.AddressLimit,
        other_table.upsertVerified(&table_rejected_peer, &table_rejected_record, 1, .outgoing),
    );
}

test "routing table compresses distances one through 240 into one bucket" {
    const local_id = [_]u8{0} ** 32;
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, local_id);
    defer table.deinit(std.testing.allocator);

    var oldest: types.NodeId = undefined;
    for (0..RoutingTable.bucket_size) |index| {
        const distance: u16 = @intCast(225 + index);
        const node_id = nodeAtDistance(distance, @intCast(index + 1));
        if (index == 0) oldest = node_id;
        const address = address4(10, @intCast(index + 1), 1, 1, @intCast(11_000 + index));
        var record = fakeRecord(node_id, address, 1);
        const peer = types.Endpoint{ .node_id = node_id, .address = address };
        try std.testing.expectEqual(
            RoutingTable.PutResult.inserted,
            try table.upsertVerified(&peer, &record, 1, .outgoing),
        );
    }
    const candidate_id = nodeAtDistance(224, 17);
    const candidate_address = address4(10, 17, 1, 1, 11_017);
    var candidate_record = fakeRecord(candidate_id, candidate_address, 1);
    const candidate_peer = types.Endpoint{
        .node_id = candidate_id,
        .address = candidate_address,
    };
    try expectPending(
        try table.upsertVerified(&candidate_peer, &candidate_record, 2, .outgoing),
        &oldest,
    );
}

test "routing table applies ENR updates atomically and ignores stale endpoints" {
    const local_id = [_]u8{0} ** 32;
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, local_id);
    defer table.deinit(std.testing.allocator);

    const node_id = nodeAtDistance(256, 1);
    const original_address = address4(203, 0, 113, 1, 9_000);
    var original_record = fakeRecord(node_id, original_address, 2);
    const original_peer = types.Endpoint{ .node_id = node_id, .address = original_address };
    _ = try table.upsertVerified(&original_peer, &original_record, 1, .outgoing);

    const stale_address = address4(198, 51, 100, 1, 9_001);
    var stale_record = fakeRecord(node_id, stale_address, 1);
    const stale_peer = types.Endpoint{ .node_id = node_id, .address = stale_address };
    try std.testing.expectEqual(
        RoutingTable.PutResult.refreshed,
        try table.upsertVerified(&stale_peer, &stale_record, 2, .outgoing),
    );
    try std.testing.expect(std.meta.eql(
        original_address,
        table.get(&node_id).?.peer.address,
    ));

    var updated_record = fakeRecord(node_id, stale_address, 3);
    try std.testing.expectEqual(
        RoutingTable.PutResult.updated,
        try table.upsertVerified(&stale_peer, &updated_record, 3, .outgoing),
    );
    const updated = table.get(&node_id).?;
    try std.testing.expect(std.meta.eql(stale_address, updated.peer.address));
    try std.testing.expectEqual(@as(u64, 3), updated.record.sequence);
}

test "routing table refreshes authenticated resident and pending endpoints independently of ENR revision" {
    for ([_]bool{ false, true }) |pending| {
        var table: RoutingTable = undefined;
        try table.init(std.testing.allocator, @splat(0));
        defer table.deinit(std.testing.allocator);
        if (pending) for (0..RoutingTable.bucket_size) |index| {
            const id = nodeAtDistance(256, @intCast(index + 1));
            const ip = address4(10, @intCast(index + 1), 0, 1, 9000);
            const record = fakeRecord(id, ip, 1);
            _ = try table.upsertVerified(&.{ .node_id = id, .address = ip }, &record, 0, .outgoing);
        };
        const id = nodeAtDistance(256, 17);
        const ip4 = address4(192, 0, 2, 1, 9000);
        const ip6 = address6(.{ 0x20, 1, 0x0d, 0xb8 } ++ .{0} ** 11 ++ .{1}, 9001);
        var record = fakeRecord(id, ip4, 2);
        record.ip6 = ip6.ip6.octets;
        record.udp6 = ip6.port();
        _ = try table.upsertVerified(&.{ .node_id = id, .address = ip4 }, &record, 1, .outgoing);
        _ = try table.upsertVerified(&.{ .node_id = id, .address = ip6 }, &record, 2, .outgoing);
        const refreshed = if (pending) table.pending[RoutingTable.bucket_count - 1].?.entry else table.get(&id).?;
        try std.testing.expectEqualDeep(ip6, refreshed.peer.address);
        try std.testing.expectEqualDeep(record, refreshed.record);
        try std.testing.expectEqual(@as(u64, 2), refreshed.last_verified_ms);

        var older = record;
        older.sequence = 1;
        _ = try table.upsertVerified(&.{ .node_id = id, .address = ip4 }, &older, 3, .outgoing);
        const retained = if (pending) table.pending[RoutingTable.bucket_count - 1].?.entry else table.get(&id).?;
        try std.testing.expectEqualDeep(ip4, retained.peer.address);
        try std.testing.expectEqualDeep(record, retained.record);

        var newer = record;
        newer.sequence = 3;
        newer.ip4 = null;
        _ = try table.upsertVerified(&.{ .node_id = id, .address = ip6 }, &newer, 4, .outgoing);
        _ = try table.upsertVerified(&.{ .node_id = id, .address = ip4 }, &record, 5, .outgoing);
        older.sequence = 3;
        _ = try table.upsertVerified(&.{ .node_id = id, .address = ip4 }, &older, 6, .outgoing);
        if (pending) {
            const incumbent = table.revalidationTarget().?;
            _ = try table.resolveRevalidation(&incumbent.peer.node_id, false, 7);
        }
        const current = table.get(&id).?;
        try std.testing.expectEqualDeep(ip6, current.peer.address);
        try std.testing.expectEqualDeep(newer, current.record);
        try std.testing.expectEqual(@as(u64, 6), current.last_verified_ms);
        var closest: [1]RoutingTable.Entry = undefined;
        try std.testing.expectEqualDeep(ip6, table.closest(&id, &closest)[0].peer.address);
        var cursor: usize = 0;
        var found = false;
        for (0..RoutingTable.bucket_size) |_| {
            const probe = table.maintenanceTarget(&cursor, 100, 1) orelse break;
            if (!std.mem.eql(u8, &id, &probe.peer.node_id)) continue;
            try std.testing.expectEqualDeep(ip6, probe.peer.address);
            found = true;
            break;
        }
        try std.testing.expect(found);
    }
}

test "routing table preflights endpoint refresh quotas before changing entries or replacements" {
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, @splat(0));
    defer table.deinit(std.testing.allocator);
    const subject_id = nodeAtDistance(256, 1);
    const pending_id = nodeAtDistance(256, 17);
    const ip6 = address6(.{ 0x20, 1, 0x0d, 0xb8 } ++ .{0} ** 11 ++ .{1}, 9001);
    var subject_record = fakeRecord(subject_id, address4(10, 1, 0, 1, 9000), 1);
    subject_record.ip6 = ip6.ip6.octets;
    subject_record.udp6 = ip6.port();
    _ = try table.upsertVerified(&.{ .node_id = subject_id, .address = subject_record.endpoint().? }, &subject_record, 1, .outgoing);
    for (1..RoutingTable.bucket_size) |index| {
        const id = nodeAtDistance(256, @intCast(index + 1));
        var ip = if (index <= RoutingTable.bucket_subnet_limit) ip6 else address4(10, @intCast(index + 1), 0, 1, 9000);
        if (ip == .ip6) ip.ip6.octets[15] = @intCast(index + 1);
        const record = fakeRecord(id, ip, 1);
        _ = try table.upsertVerified(&.{ .node_id = id, .address = ip }, &record, 1, .outgoing);
    }
    var pending_record = fakeRecord(pending_id, address4(10, 17, 0, 1, 9000), 1);
    pending_record.ip6 = ip6.ip6.octets;
    pending_record.udp6 = ip6.port();
    _ = try table.upsertVerified(&.{ .node_id = pending_id, .address = pending_record.endpoint().? }, &pending_record, 1, .outgoing);
    const subject_before = table.get(&subject_id).?;
    const pending_before = table.pending[RoutingTable.bucket_count - 1].?;
    for ([_]*const enr.Record{ &subject_record, &pending_record }) |record| {
        try std.testing.expectError(error.AddressLimit, table.upsertVerified(&.{ .node_id = record.node_id, .address = ip6 }, record, 2, .outgoing));
        try std.testing.expectEqualDeep(subject_before, table.get(&subject_id).?);
        try std.testing.expectEqualDeep(pending_before, table.pending[RoutingTable.bucket_count - 1].?);
        try std.testing.expectEqualDeep(subject_id, table.revalidationTarget().?.peer.node_id);
    }
}

test "routing table applies bucket limits across IPv6 subnets in one /48" {
    const local_id = [_]u8{0} ** 32;
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, local_id);
    defer table.deinit(std.testing.allocator);

    for (1..RoutingTable.bucket_subnet_limit + 1) |salt| {
        const node_id = nodeAtDistance(256, @intCast(salt));
        var octets = [_]u8{0} ** 16;
        octets[0..8].* = [_]u8{ 0x20, 0x01, 0x0d, 0xb8, 0, 1, 0, 1 };
        octets[6] = @intCast(salt);
        octets[15] = @intCast(salt);
        const address = types.Address{ .ip6 = .{
            .octets = octets,
            .port = @intCast(9_000 + salt),
        } };
        var record = fakeRecord(node_id, address, 1);
        const peer = types.Endpoint{ .node_id = node_id, .address = address };
        _ = try table.upsertVerified(&peer, &record, 1, .outgoing);
    }
    const rejected_id = nodeAtDistance(256, 3);
    var rejected_octets = [_]u8{0} ** 16;
    rejected_octets[0..8].* = [_]u8{ 0x20, 0x01, 0x0d, 0xb8, 0, 1, 0, 1 };
    rejected_octets[6] = 3;
    rejected_octets[15] = 3;
    const rejected_address = types.Address{ .ip6 = .{
        .octets = rejected_octets,
        .port = 9_003,
    } };
    var rejected_record = fakeRecord(rejected_id, rejected_address, 1);
    const rejected_peer = types.Endpoint{
        .node_id = rejected_id,
        .address = rejected_address,
    };
    try std.testing.expectError(
        error.AddressLimit,
        table.upsertVerified(&rejected_peer, &rejected_record, 1, .outgoing),
    );
    var distinct_peer = rejected_peer;
    distinct_peer.address.ip6.octets[5] += 1;
    var distinct_record = fakeRecord(distinct_peer.node_id, distinct_peer.address, 1);
    _ = try table.upsertVerified(&distinct_peer, &distinct_record, 1, .outgoing);
}

test "routing table applies table limits across IPv6 subnets in one /48" {
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, @splat(0));
    defer table.deinit(std.testing.allocator);

    for (0..RoutingTable.table_subnet_limit + 1) |index| {
        const node_id = nodeAtDistance(@intCast(241 + index), @intCast(index + 1));
        var octets = [_]u8{0} ** 16;
        octets[0..6].* = .{ 0x20, 1, 0x0d, 0xb8, 0, 1 };
        octets[6] = @intCast(index);
        octets[15] = 1;
        const peer: types.Endpoint = .{ .node_id = node_id, .address = .{ .ip6 = .{ .octets = octets, .port = 9000 } } };
        var record = fakeRecord(peer.node_id, peer.address, 1);
        if (index < RoutingTable.table_subnet_limit) {
            _ = try table.upsertVerified(&peer, &record, 1, .outgoing);
        } else {
            try std.testing.expectError(error.AddressLimit, table.upsertVerified(&peer, &record, 1, .outgoing));
        }
    }
}

test "routing FINDNODE selection filters exact distances and caps the aggregate" {
    const local_id = [_]u8{0} ** 32;
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, local_id);
    defer table.deinit(std.testing.allocator);

    var local_record = fakeRecord(local_id, address4(127, 0, 0, 1, 9_000), 1);
    for (0..RoutingTable.bucket_size) |index| {
        const node_id = nodeAtDistance(256, @intCast(index + 1));
        const address = address4(10, @intCast(index + 1), 0, 1, @intCast(9_001 + index));
        var record = fakeRecord(node_id, address, 1);
        const peer = types.Endpoint{ .node_id = node_id, .address = address };
        _ = try table.upsertVerified(&peer, &record, 1, .outgoing);
    }
    const distance_241_id = nodeAtDistance(241, 1);
    const distance_241_address = address4(172, 16, 1, 1, 10_001);
    var distance_241_record = fakeRecord(distance_241_id, distance_241_address, 1);
    const distance_241_peer = types.Endpoint{
        .node_id = distance_241_id,
        .address = distance_241_address,
    };
    _ = try table.upsertVerified(&distance_241_peer, &distance_241_record, 1, .outgoing);

    var out: [types.findnode_result_max + 4]enr.Record = undefined;
    const selected = try table.findNodes(&local_record, null, &.{ 0, 241, 241, 256 }, &out);
    try std.testing.expectEqual(types.findnode_result_max, selected.len);
    try std.testing.expectEqualSlices(u8, &local_id, &selected[0].node_id);
    try std.testing.expectEqualSlices(u8, &distance_241_id, &selected[1].node_id);
    for (selected[2..]) |record| {
        try std.testing.expectEqual(@as(u16, 256), types.logDistance(&local_id, &record.node_id));
    }
    const sparse = try table.findNodes(&local_record, null, &.{241}, &out);
    try std.testing.expectEqual(@as(usize, 1), sparse.len);
    try std.testing.expectEqualSlices(u8, &distance_241_id, &sparse[0].node_id);

    const descending = try table.findNodes(&local_record, null, &.{ 256, 241, 256 }, &out);
    try std.testing.expectEqual(types.findnode_result_max, descending.len);
    for (descending) |record| try std.testing.expectEqual(@as(u16, 256), types.logDistance(&local_id, &record.node_id));
    const self_last = try table.findNodes(&local_record, null, &.{ 256, 0, 241 }, &out);
    try std.testing.expectEqual(types.findnode_result_max, self_last.len);
    try std.testing.expectEqualSlices(u8, &local_id, &self_last[0].node_id);
    for (self_last[1..]) |record| try std.testing.expectEqual(@as(u16, 256), types.logDistance(&local_id, &record.node_id));
    try std.testing.expectError(error.InvalidDistance, table.findNodes(&local_record, null, &.{ 256, 257 }, &out));

    try std.testing.expectError(
        error.InvalidDistance,
        table.findNodes(&local_record, null, &.{ 0, 257 }, &out),
    );
    var too_many = [_]u16{0} ** (types.distance_count + 1);
    try std.testing.expectError(
        error.TooManyDistances,
        table.findNodes(&local_record, null, &too_many, &out),
    );
}

test "routing closest selection is sorted and bounded" {
    const local_id = [_]u8{0} ** 32;
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, local_id);
    defer table.deinit(std.testing.allocator);

    for (0..RoutingTable.bucket_size + 2) |index| {
        const distance: u16 = @intCast(239 + index);
        const node_id = nodeAtDistance(distance, @intCast(index + 1));
        const address = address4(10, @intCast(index + 1), 2, 1, @intCast(12_000 + index));
        var record = fakeRecord(node_id, address, 1);
        const peer = types.Endpoint{ .node_id = node_id, .address = address };
        _ = try table.upsertVerified(&peer, &record, 1, .outgoing);
    }

    var out: [RoutingTable.bucket_size + 4]RoutingTable.Entry = undefined;
    const selected = table.closest(&local_id, &out);
    try std.testing.expectEqual(RoutingTable.bucket_size, selected.len);
    for (selected[1..], selected[0 .. selected.len - 1]) |entry, previous| {
        try std.testing.expect(std.mem.order(
            u8,
            &previous.peer.node_id,
            &entry.peer.node_id,
        ) == .lt);
    }
    try std.testing.expectEqual(@as(u16, 239), types.logDistance(
        &local_id,
        &selected[0].peer.node_id,
    ));
    try std.testing.expectEqual(@as(u16, 254), types.logDistance(
        &local_id,
        &selected[selected.len - 1].peer.node_id,
    ));
}

test "routing FINDNODE does not relay special-scope addresses" {
    const local_id = [_]u8{0} ** 32;
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, local_id);
    defer table.deinit(std.testing.allocator);

    var local_record = fakeRecord(local_id, address4(127, 0, 0, 1, 9_000), 1);
    const private_id = nodeAtDistance(256, 1);
    const private_address = address4(10, 0, 0, 1, 9_001);
    var private_record = fakeRecord(private_id, private_address, 1);
    const private_peer = types.Endpoint{ .node_id = private_id, .address = private_address };
    _ = try table.upsertVerified(&private_peer, &private_record, 1, .outgoing);
    const public_id = nodeAtDistance(255, 2);
    const public_address = address4(198, 51, 100, 1, 9_002);
    var public_record = fakeRecord(public_id, public_address, 1);
    const public_peer = types.Endpoint{ .node_id = public_id, .address = public_address };
    _ = try table.upsertVerified(&public_peer, &public_record, 1, .outgoing);

    var out: [3]enr.Record = undefined;
    const selected = try table.findNodes(
        &local_record,
        address4(203, 0, 113, 1, 9_003),
        &.{ 0, 255, 256 },
        &out,
    );
    try std.testing.expectEqual(@as(usize, 1), selected.len);
    try std.testing.expectEqual(public_id, selected[0].node_id);
}

test "routing FINDNODE returns the local record before endpoint discovery" {
    const key = try test_support.keyPair(1);
    const public_key = crypto.compressedPublicKey(&key);
    const local = try enr.Record.createFields(&key, 7, &.{
        .{ .key = "id", .value = .{ .bytes = "v4" } },
        .{ .key = "secp256k1", .value = .{ .bytes = &public_key } },
    });
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, local.node_id);
    defer table.deinit(std.testing.allocator);
    var out: [1]enr.Record = undefined;
    const requester = address4(203, 0, 113, 2, 9000);
    const selected = try table.findNodes(&local, requester, &.{0}, &out);
    try std.testing.expectEqual(@as(usize, 1), selected.len);
    try std.testing.expectEqualDeep(local, selected[0]);
    try std.testing.expectEqual(@as(usize, 0), (try table.findNodes(&local, requester, &.{1}, &out)).len);
    try std.testing.expectEqual(@as(usize, 0), (try table.findNodes(&local, requester, &.{0}, out[0..0])).len);
}

test "routing table rejects inconsistent records and unusable endpoints" {
    const local_id = [_]u8{0} ** 32;
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, local_id);
    defer table.deinit(std.testing.allocator);

    const remote_id = nodeAtDistance(256, 1);
    const address = address4(203, 0, 113, 1, 9_000);
    var record = fakeRecord(remote_id, address, 1);
    var peer = types.Endpoint{ .node_id = local_id, .address = address };
    try std.testing.expectError(
        error.SelfEntry,
        table.upsertVerified(&peer, &record, 1, .outgoing),
    );

    peer.node_id = remote_id;
    record.node_id = nodeAtDistance(255, 2);
    try std.testing.expectError(
        error.InvalidRemoteRecord,
        table.upsertVerified(&peer, &record, 1, .outgoing),
    );
    record.node_id = remote_id;
    peer.address = address4(203, 0, 113, 2, 9_000);
    try std.testing.expectError(
        error.InvalidRemoteRecord,
        table.upsertVerified(&peer, &record, 1, .outgoing),
    );
    peer.address = address4(203, 0, 113, 1, 0);
    record.udp = 0;
    try std.testing.expectError(
        error.InvalidRemoteRecord,
        table.upsertVerified(&peer, &record, 1, .outgoing),
    );
}

fn expectPending(result: RoutingTable.PutResult, expected: *const types.NodeId) !void {
    switch (result) {
        .pending => |node_id| try std.testing.expectEqualSlices(u8, expected, &node_id),
        else => return error.TestUnexpectedResult,
    }
}

fn nodeAtDistance(distance: u16, salt: u8) types.NodeId {
    std.debug.assert(distance > 8 and distance <= types.distance_max);
    var node_id = [_]u8{0} ** 32;
    const leading_index = types.distance_max - distance;
    const byte_index = leading_index / 8;
    const bit_index: u3 = @intCast(7 - leading_index % 8);
    node_id[byte_index] = @as(u8, 1) << bit_index;
    node_id[31] = salt;
    return node_id;
}

test "routing maintenance selects quiet peers fairly and protects recent traffic from eviction" {
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, [_]u8{0} ** 32);
    defer table.deinit(std.testing.allocator);
    const first_id = nodeAtDistance(256, 1);
    const second_id = nodeAtDistance(255, 2);
    const first_address = address4(203, 1, 1, 1, 9_001);
    const second_address = address4(203, 2, 1, 1, 9_002);
    const first_record = fakeRecord(first_id, first_address, 1);
    const second_record = fakeRecord(second_id, second_address, 1);
    const first_peer = types.Endpoint{ .node_id = first_id, .address = first_address };
    const second_peer = types.Endpoint{ .node_id = second_id, .address = second_address };
    _ = try table.upsertVerified(&first_peer, &first_record, 0, .outgoing);
    _ = try table.upsertVerified(&second_peer, &second_record, 0, .outgoing);
    var cursor: usize = 0;
    try std.testing.expect(table.maintenanceTarget(&cursor, 99, 100) == null);
    const first = table.maintenanceTarget(&cursor, 100, 100).?;
    const second = table.maintenanceTarget(&cursor, 100, 100).?;
    try std.testing.expect(!std.mem.eql(u8, &first.peer.node_id, &second.peer.node_id));
    _ = try table.upsertVerified(&first.peer, &first.record, 101, .outgoing);
    try std.testing.expect(!table.markUnresponsive(&first.peer.node_id, 0));
    try std.testing.expect(table.markUnresponsive(&second.peer.node_id, 0));
    try std.testing.expectEqual(@as(usize, 2), table.count());
    try std.testing.expect(table.get(&second.peer.node_id).?.last_verified_ms == null);
    try std.testing.expect(!table.markUnresponsive(&second.peer.node_id, 0));
}

test "routing periodic maintenance leaves pending replacements to revalidation" {
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, [_]u8{0} ** 32);
    defer table.deinit(std.testing.allocator);
    for (0..RoutingTable.bucket_size + 1) |index| {
        const node_id = nodeAtDistance(256, @intCast(index + 1));
        const address = address4(10, @intCast(index + 1), 0, 1, @intCast(9_000 + index));
        const remote_record = fakeRecord(node_id, address, 1);
        const peer = types.Endpoint{ .node_id = node_id, .address = address };
        _ = try table.upsertVerified(&peer, &remote_record, 0, .outgoing);
    }
    const incumbent = table.revalidationTarget().?;
    var cursor: usize = 0;
    const periodic = table.maintenanceTarget(&cursor, 100, 100).?;
    try std.testing.expect(!std.mem.eql(u8, &incumbent.peer.node_id, &periodic.peer.node_id));
    try std.testing.expect(!table.markUnresponsive(&incumbent.peer.node_id, 0));
    try std.testing.expectEqual(@as(usize, 1), table.pendingCount());
    try std.testing.expectEqual(RoutingTable.bucket_size, table.count());
}

test "routing table reserves half of each bucket for outgoing peers" {
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, @splat(0));
    defer table.deinit(std.testing.allocator);
    for (0..RoutingTable.bucket_size / 2) |index| {
        const id = nodeAtDistance(256, @intCast(index + 1));
        const address = address4(10, @intCast(index + 1), 0, 1, 9000);
        const record = fakeRecord(id, address, 1);
        const peer: types.Endpoint = .{ .node_id = id, .address = address };
        try std.testing.expectEqual(RoutingTable.PutResult.inserted, try table.upsertVerified(&peer, &record, 0, .incoming));
        _ = try table.upsertVerified(&peer, &record, 1, .outgoing);
        try std.testing.expectEqual(RoutingTable.Direction.incoming, table.get(&id).?.direction);
    }
    const id = nodeAtDistance(256, 20);
    const address = address4(10, 20, 0, 1, 9000);
    const record = fakeRecord(id, address, 1);
    const peer: types.Endpoint = .{ .node_id = id, .address = address };
    try std.testing.expectError(error.IncomingLimit, table.upsertVerified(&peer, &record, 2, .incoming));
    try std.testing.expectEqual(RoutingTable.PutResult.inserted, try table.upsertVerified(&peer, &record, 2, .outgoing));
}

test "routing traversal is bounded ordered and returns independent copies" {
    var table: RoutingTable = undefined;
    try table.init(std.testing.allocator, @splat(0));
    defer table.deinit(std.testing.allocator);
    var cursor: usize = 13;
    var empty = table.iterate(&cursor);
    try std.testing.expect(empty.next() == null);
    try std.testing.expectEqual(@as(usize, 13), cursor);
    try std.testing.expect(empty.next() == null);

    const ids = [_]types.NodeId{ nodeAtDistance(241, 1), nodeAtDistance(256, 1), nodeAtDistance(256, 2) };
    for (ids, 0..) |id, i| {
        const address = address4(203, @intCast(i + 1), 1, 1, 9000);
        const record = fakeRecord(id, address, 1);
        const peer: types.Endpoint = .{ .node_id = id, .address = address };
        if (i == 1) {
            try std.testing.expect(try table.addKnown(&peer, &record));
        } else {
            _ = try table.upsertVerified(&peer, &record, 0, .outgoing);
        }
    }
    cursor = 0;
    var iterator = table.iterate(&cursor);
    for (ids, 0..) |id, i| {
        var entry = iterator.next().?;
        try std.testing.expectEqual(id, entry.peer.node_id);
        try std.testing.expectEqual(i == 1, entry.last_verified_ms == null);
        entry.record.sequence = 99;
        try std.testing.expectEqual(@as(u64, 1), table.get(&id).?.record.sequence);
    }
    try std.testing.expect(iterator.next() == null);
    try std.testing.expectEqual(@as(usize, 0), cursor);
    try std.testing.expect(iterator.next() == null);

    cursor = RoutingTable.table_capacity - 1;
    var wrapped = table.iterate(&cursor);
    for (ids) |id| try std.testing.expectEqual(id, wrapped.next().?.peer.node_id);
    try std.testing.expect(wrapped.next() == null);
    try std.testing.expectEqual(RoutingTable.table_capacity - 1, cursor);
}
