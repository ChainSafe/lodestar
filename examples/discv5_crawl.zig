//! Starts one DiscV5 node, seeds configured bootnodes, and runs a bounded set of
//! concurrent random lookups.
//!
//! zig build run:discv5_crawl -- 0.0.0.0:9000 203.0.113.10:9000
//!     [--duration-seconds 60] enr:... [enr:...]

const std = @import("std");
const discv5 = @import("discv5");
const lookup_batch = @import("discv5/lookup_batch.zig");
const Sockets = @import("udp").Sockets;

const net = std.Io.net;
const bootstrap_capacity: usize = 64;
const call_capacity: usize = 64;
const crawl_duration_seconds_default: u16 = 60;
const crawl_duration_seconds_max: u16 = 300;
const transport_steps_max: usize = 12_000;
const key_generation_attempts_max: usize = 16;
const lookup_concurrency: usize = 16;
const lookup_total_max: usize = 64;
const record_capacity: usize = 8_192;

const LookupSlot = struct {
    operation: discv5.Lookup = undefined,
    active: bool = false,

    fn cancel(self: *LookupSlot, core: *discv5.Engine) void {
        if (!self.active) return;
        self.operation.cancel(core);
        self.active = false;
    }
};

const RecordSet = struct {
    records: []discv5.identity.enr.Record,
    indices: std.AutoHashMapUnmanaged(discv5.types.NodeId, u16),
    count: u16 = 0,

    fn init(allocator: std.mem.Allocator) !RecordSet {
        const records = try allocator.alloc(discv5.identity.enr.Record, record_capacity);
        errdefer allocator.free(records);

        var indices: std.AutoHashMapUnmanaged(discv5.types.NodeId, u16) = .empty;
        errdefer indices.deinit(allocator);
        try indices.ensureTotalCapacity(allocator, @intCast(record_capacity));

        return .{ .records = records, .indices = indices };
    }

    fn deinit(self: *RecordSet, allocator: std.mem.Allocator) void {
        self.indices.deinit(allocator);
        allocator.free(self.records);
        self.* = undefined;
    }

    fn add(self: *RecordSet, record: *const discv5.identity.enr.Record) bool {
        if (self.indices.get(record.node_id)) |index| {
            const stored = &self.records[index];
            if (record.sequence > stored.sequence) stored.* = record.*;
            return false;
        }
        if (self.count == self.records.len) return false;
        self.records[self.count] = record.*;
        self.indices.putAssumeCapacityNoClobber(record.node_id, self.count);
        self.count += 1;
        return true;
    }
};

pub fn main(init: std.process.Init) !void {
    var gpa: std.heap.DebugAllocator(.{}) = .{};
    defer std.debug.assert(gpa.deinit() == .ok);
    const allocator = gpa.allocator();
    const io = init.io;
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len < 4) {
        std.debug.print(
            "usage: {s} <bind-ip:port> <advertised-ip:port> " ++
                "[--duration-seconds <1..300>] <boot-enr> [boot-enr...]\n",
            .{args[0]},
        );
        return;
    }
    var duration_seconds = crawl_duration_seconds_default;
    var bootnode_start: usize = 3;
    if (std.mem.eql(u8, args[3], "--duration-seconds")) {
        if (args.len < 6) return error.MissingDurationOrBootnode;
        duration_seconds = try std.fmt.parseInt(u16, args[4], 10);
        if (duration_seconds == 0 or duration_seconds > crawl_duration_seconds_max)
            return error.InvalidDuration;
        bootnode_start = 5;
    }
    if (args.len - bootnode_start > bootstrap_capacity) return error.TooManyBootnodes;
    const started_ms = try discv5.Transport.monotonicMilliseconds(io);
    const duration_ms = @as(u64, duration_seconds) * std.time.ms_per_s;
    const deadline_ms = std.math.add(u64, started_ms, duration_ms) catch
        return error.ClockOutOfRange;

    const bind_address = try net.IpAddress.parseLiteral(args[1]);
    const advertised_address = discv5.types.Address.fromNetwork(try net.IpAddress.parseLiteral(args[2]));
    var sockets = try Sockets.bind(io, .single(bind_address));
    var sockets_owned = true;
    errdefer if (sockets_owned) sockets.close(io);
    const bound_address = discv5.types.Address.fromNetwork(sockets.primary().address);
    if (std.meta.activeTag(bound_address) != std.meta.activeTag(advertised_address))
        return error.AdvertisedAddressFamilyMismatch;
    if (bound_address.port() != advertised_address.port())
        return error.AdvertisedPortMismatch;

    var key_pair = try randomKeyPair(io);
    defer std.crypto.secureZero(u8, std.mem.asBytes(&key_pair));
    const local_record = try discv5.identity.enr.Record.create(
        &key_pair,
        1,
        advertised_address,
    );
    var transport: discv5.Transport = undefined;
    try transport.init(allocator, sockets, key_pair, local_record, .{
        .session_capacity = 256,
        .challenge_capacity = 1024,
        .call_capacity = call_capacity,
        .request_timeout_ms = 1_000,
        .challenge_timeout_ms = 1_000,
        .session_idle_timeout_ms = 86_400_000,
    });
    sockets_owned = false;
    defer transport.deinit(allocator, io);

    var bootstraps: [bootstrap_capacity]discv5.identity.enr.Record = undefined;
    const bootstraps_slice = try parseBootstraps(
        args[bootnode_start..],
        sockets.mode(),
        &bootstraps,
    );
    var records = try RecordSet.init(allocator);
    defer records.deinit(allocator);
    for (bootstraps_slice) |*record| {
        _ = transport.engine.routing.addKnown(&endpoint(record, sockets.mode()), record) catch |err| switch (err) {
            error.AddressLimit, error.SelfEntry => continue,
            else => return err,
        };
        _ = records.add(record);
    }
    if (transport.engine.peerCount() == 0) return error.NoUsableBootnodes;
    std.debug.print(
        "node bound on {any}, seeded {d} bootnodes\n",
        .{ discv5.types.Address.fromNetwork(sockets.primary().address), transport.engine.peerCount() },
    );
    try crawl(io, allocator, &transport, &records, deadline_ms);
    const elapsed_ms = (try discv5.Transport.monotonicMilliseconds(io)) - started_ms;
    std.debug.print(
        "collected {d} validated peer records from {d} routing entries in {d} ms\n",
        .{ records.count, transport.engine.peerCount(), elapsed_ms },
    );
    for (records.records[0..records.count]) |*record| printRecord(record);
}

fn parseBootstraps(
    encoded: []const [:0]const u8,
    ip_mode: discv5.types.Mode,
    storage: *[bootstrap_capacity]discv5.identity.enr.Record,
) ![]discv5.identity.enr.Record {
    var count: usize = 0;
    for (encoded) |text| {
        const record = try discv5.identity.enr.Record.initText(text);
        _ = record.endpoint() orelse return error.BootnodeHasNoUdpEndpoint;
        _ = record.endpointFor(ip_mode) orelse continue;
        var duplicate = false;
        for (storage[0..count]) |*stored| {
            if (!std.mem.eql(u8, &stored.node_id, &record.node_id)) continue;
            duplicate = true;
            break;
        }
        if (duplicate) continue;
        storage[count] = record;
        count += 1;
    }
    if (count == 0) return error.NoBootnodes;
    return storage[0..count];
}

fn crawl(
    io: std.Io,
    allocator: std.mem.Allocator,
    transport: *discv5.Transport,
    records: *RecordSet,
    deadline_ms: u64,
) !void {
    const candidates = try allocator.alloc(discv5.Lookup.Candidates, lookup_concurrency);
    defer allocator.free(candidates);
    var maintenance: discv5.Maintenance = undefined;
    try maintenance.init(try discv5.Transport.monotonicMilliseconds(io), .{
        .probe_interval_ms = 10_000,
        .stale_after_ms = 15_000,
    }, transport.sockets.mode());
    defer maintenance.cancel(&transport.engine);
    var cursor: lookup_batch.Cursor = .{};
    var statistics: CrawlStatistics = .{};
    var slots = [_]LookupSlot{.{}} ** lookup_concurrency;
    defer for (&slots) |*slot| slot.cancel(&transport.engine);
    var expired: [call_capacity]discv5.CallTable.Expired = undefined;
    var operations: [lookup_concurrency]*discv5.Lookup = undefined;
    var launched: usize = 0;
    var completed: usize = 0;
    var rejections = std.EnumArray(discv5.types.RejectReason, u32).initFill(0);

    for (0..transport_steps_max) |_| {
        if (try discv5.Transport.monotonicMilliseconds(io) >= deadline_ms) break;
        try startMaintenance(io, transport, &maintenance);
        try startLookups(io, transport, &slots, candidates[0..lookup_concurrency], &launched);

        const active = activeLookups(&slots, &operations);
        const result = try lookup_batch.step(transport, io, active, &cursor, &expired);
        switch (result.transport.datagram) {
            .rejected => |reason| rejections.getPtr(reason).* += 1,
            .timeout, .accepted => {},
        }
        for (expired[0..result.transport.calls_expired]) |item| {
            _ = maintenance.onFailure(&transport.engine, item.handle, result.transport.now_ms, .expired);
        }
        _ = maintenance.onEvent(&transport.engine, &result.transport.event, result.transport.now_ms);
        if (result.transport.event == .response) {
            for (result.transport.event.response.node_records) |*record| _ = records.add(record);
        }
        statistics.failures += result.progress.failures;
        completed += finishLookups(&transport.engine, &slots, &statistics);
        if (result.failure) |err| return err;
        if (completed == lookup_total_max and activeLookups(&slots, &operations).len == 0) break;
        if (records.count == record_capacity) break;
    }

    for (&slots) |*slot| {
        if (slot.active) slot.operation.cancel(&transport.engine);
    }
    completed += finishLookups(&transport.engine, &slots, &statistics);

    std.debug.print("lookups launched={d} terminal={d}\n", .{ launched, completed });
    std.debug.print("lookup_queries={d} lookup_failures={d} capacity_drops={d} candidate_bytes={d}\n", .{
        statistics.queries,                                 statistics.failures, statistics.capacity_drops,
        candidates.len * @sizeOf(discv5.Lookup.Candidates),
    });
    for (std.enums.values(discv5.Lookup.FinishReason)) |reason| {
        std.debug.print("  {s}={d}\n", .{ @tagName(reason), statistics.finished.get(reason) });
    }
    printRejections(&rejections);
}

const CrawlStatistics = struct {
    queries: u32 = 0,
    failures: u32 = 0,
    capacity_drops: u64 = 0,
    finished: std.EnumArray(discv5.Lookup.FinishReason, u16) = .initFill(0),
};

fn startMaintenance(io: std.Io, transport: *discv5.Transport, maintenance: *discv5.Maintenance) !void {
    const result = try transport.startMaintenance(io, maintenance, try discv5.Transport.monotonicMilliseconds(io));
    if (result.failure) |err| if (err != error.DestinationUnreachable) return err;
}

fn printRejections(rejections: *const std.EnumArray(discv5.types.RejectReason, u32)) void {
    var total: u32 = 0;
    for (std.enums.values(discv5.types.RejectReason)) |reason| total += rejections.get(reason);
    std.debug.print("rejected_datagrams={d}\n", .{total});
    for (std.enums.values(discv5.types.RejectReason)) |reason| {
        const count = rejections.get(reason);
        if (count > 0) std.debug.print("  {s}={d}\n", .{ @tagName(reason), count });
    }
}

fn startLookups(
    io: std.Io,
    transport: *discv5.Transport,
    slots: *[lookup_concurrency]LookupSlot,
    candidates: []discv5.Lookup.Candidates,
    launched: *usize,
) !void {
    const core = &transport.engine;
    for (slots, candidates) |*slot, *storage| {
        if (slot.active or launched.* == lookup_total_max) continue;
        var target: discv5.types.NodeId = undefined;
        try std.Io.randomSecure(io, &target);
        var seeds_buffer: [discv5.Lookup.result_max]discv5.RoutingTable.Entry = undefined;
        const seeds = core.closestNodes(&target, &seeds_buffer);
        if (seeds.len == 0) return;
        try slot.operation.init(storage, core.localRecord().node_id, target, seeds, transport.sockets.mode());
        slot.active = true;
        launched.* += 1;
    }
}

fn activeLookups(
    slots: *[lookup_concurrency]LookupSlot,
    out: *[lookup_concurrency]*discv5.Lookup,
) []const *discv5.Lookup {
    var count: usize = 0;
    for (slots) |*slot| {
        if (!slot.active) continue;
        out[count] = &slot.operation;
        count += 1;
    }
    return out[0..count];
}

fn finishLookups(
    core: *discv5.Engine,
    slots: *[lookup_concurrency]LookupSlot,
    statistics: *CrawlStatistics,
) usize {
    var completed: usize = 0;
    for (slots) |*slot| {
        if (!slot.active or !slot.operation.isFinished()) continue;
        const lookup_statistics = slot.operation.statistics();
        statistics.queries += lookup_statistics.queries_started;
        statistics.capacity_drops += lookup_statistics.capacity_drops;
        statistics.finished.getPtr(slot.operation.finishReason().?).* += 1;
        slot.cancel(core);
        completed += 1;
    }
    return completed;
}

fn endpoint(record: *const discv5.identity.enr.Record, ip_mode: discv5.types.Mode) discv5.types.Endpoint {
    return .{ .node_id = record.node_id, .address = record.endpointFor(ip_mode).? };
}

fn randomKeyPair(io: std.Io) !discv5.identity.crypto.KeyPair {
    for (0..key_generation_attempts_max) |_| {
        var secret: [32]u8 = undefined;
        try std.Io.randomSecure(io, &secret);
        const key_pair = discv5.identity.crypto.keyPairFromSecret(&secret) catch {
            std.crypto.secureZero(u8, &secret);
            continue;
        };
        std.crypto.secureZero(u8, &secret);
        return key_pair;
    }
    return error.KeyGenerationFailed;
}

fn printRecord(record: *const discv5.identity.enr.Record) void {
    var encoded_buffer: [512]u8 = undefined;
    const encoded = std.base64.url_safe_no_pad.Encoder.encode(
        &encoded_buffer,
        record.slice(),
    );
    std.debug.print("enr:{s}\n", .{encoded});
}

comptime {
    std.debug.assert(transport_steps_max <= std.math.maxInt(u32));
    std.debug.assert(lookup_concurrency <= lookup_batch.operations_max);
    std.debug.assert(lookup_concurrency * discv5.Lookup.parallelism + 1 <= call_capacity);
    std.debug.assert(record_capacity <= std.math.maxInt(u16));
    std.debug.assert(record_capacity >= discv5.RoutingTable.table_capacity);
}
