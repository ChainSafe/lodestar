const Catalog = @import("catalog.zig").Catalog;
const std = @import("std");
const d = @import("discv5");
const adapter = @import("enr.zig");
const types = @import("types.zig");
const vectors = @import("enr_vectors.zig").vectors;
const context = types.ForkContext{ .digest = .{ 1, 2, 3, 4 }, .custody_groups = 128 };
const Dialing = @import("dialing.zig").Dialing;

const support = @import("enr_test_support.zig");
const signingKey = support.signingKey;
const advertisement = support.advertisement;
const changedRecord = support.changedRecord;

test "peer ENR canonical fingerprint rejects equal sequence changes outside dial hints" {
    const key = try signingKey();
    const original = try adapter.build(&key, 8, &advertisement(), &context);
    const candidate = try adapter.decode(&original, &context);
    const Queue = @import("dialing.zig").Dialing;
    var queue = try Queue.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 1 });
    var catalog = try Catalog.initWithIntents(std.testing.allocator, .{}, 1, 1024, 1);
    defer catalog.deinit(std.testing.allocator);
    try queue.enqueueDiscovered(&catalog, &candidate, &context, &.{}, 0);
    @memset(catalog.rows[0].dial.addresses[catalog.rows[0].dial.address_count..], .unspecified);
    const before = catalog.rows[0];
    for ([_]struct { name: []const u8, value: d.identity.enr.Field.Value }{
        .{ .name = "udp", .value = .{ .uint = 9002 } },
        .{ .name = "x-test", .value = .{ .bytes = "extra signed content" } },
    }) |change| {
        const changed = try changedRecord(change.name, change.value);
        const conflicting = try adapter.decode(&changed, &context);
        try std.testing.expectEqual(candidate.hints.sequence, conflicting.hints.sequence);
        try std.testing.expectEqualDeep(candidate.addresses, conflicting.addresses);
        try std.testing.expect(!std.mem.eql(u8, &candidate.hints.record_hash, &conflicting.hints.record_hash));
        try std.testing.expectError(error.StaleRecord, queue.enqueueDiscovered(&catalog, &conflicting, &context, &.{}, 100));
        try std.testing.expectEqualDeep(before, catalog.rows[0]);
    }
    try queue.enqueueDiscovered(&catalog, &candidate, &context, &.{}, 200);
    try std.testing.expectEqual(@as(u64, 200), catalog.rows[0].dial.hints_at_ms);
}

test "peer ENR zero custody remains dialable for subnet demand without custody credit" {
    const record = try d.identity.enr.Record.initText(vectors[5].text);
    const candidate = try adapter.decode(&record, &context);
    var catalog = try Catalog.initWithIntents(std.testing.allocator, .{}, 1, 1024, 1);
    defer catalog.deinit(std.testing.allocator);
    var queue = try Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 1 });
    const wanted: types.Coverage = .{ .syncnets = 1 };
    var fork = context;
    fork.fork = .fulu;
    fork.custody_requirement = 4;
    try queue.enqueueDiscovered(&catalog, &candidate, &fork, &wanted, 0);
    var budget: u16 = 64;
    try std.testing.expect(!catalog.advanceCustody(&fork, 0, 60_000, &budget));
    try std.testing.expectEqual(@as(u16, 64), budget);
    const row = catalog.rowFor(catalog.find(&candidate.peer).?).?;
    try std.testing.expectEqual(@as(?u64, 0), row.dial.hints.?.custody_group_count);
    const coverage = Catalog.candidateCoverage(row, &fork, 0);
    try std.testing.expectEqual(@as(u64, 0x8000000000000001), coverage.attnets);
    try std.testing.expectEqual(@as(u4, 5), coverage.syncnets);
    try std.testing.expectEqual(@as(usize, 0), coverage.groups.count());
    try std.testing.expectEqual(@as(usize, 0), coverage.custody_groups.count());
    queue.configureSelection(&catalog, &wanted, false, &fork, 0);
    var out: [1]Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), queue.poll(&catalog, 0, &out));
    try std.testing.expect(out[0].peer.eql(&candidate.peer));
}
