const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const gossip = @import("network").gossipsub;
const Messages = @FieldType(gossip.Gossipsub, "messages");
const Layout = std.meta.Child(@typeInfo(@TypeOf(Messages.init)).@"fn".params[2].type.?);
const Peers = @FieldType(gossip.Gossipsub, "peers");
const Validation = @FieldType(Messages, "validation");
const Store = @FieldType(Messages, "store");
const Handle = @FieldType(gossip.mcache.HistoryEntry, "message");
const Session = std.meta.Child(@FieldType(gossip.sessions.Sessions, "rows"));
const PeerIo = @FieldType(Session, "io");
const Outbox = @FieldType(PeerIo, "tx");
const assert = std.debug.assert;
const payload_max = 80 * 1024;

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(input: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0 or len > 512) return;
    var memory: [2 * 1024 * 1024]u8 = undefined;
    var arena = std.heap.FixedBufferAllocator.init(&memory);
    const a = arena.allocator();
    var peers = Peers.init(a, &.{ .retained_score_ms = 20, .connected_capacity = 4, .retained_capacity = 9, .retained_outbound_reserve = 1 }, 1) catch unreachable;
    defer peers.deinit(a);
    var boundary: gossip.topic_policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    boundary.rules[@intFromEnum(gossip.topic.Kind.beacon_block)] = .{ .count = 1, .ssz_max = payload_max };
    const options: gossip.Gossipsub.Options = .{
        .topic_policy = &.{boundary},
        .random_seed = 1,
        .connected_capacity = 3,
        .mcache_capacity = 4,
        .validation_capacity = 2,
        .seen_capacity = 8,
        .retained_capacity = 9,
        .mcache_arena_bytes = 2 * payload_max,
        .validation_timeout_ms = 10,
        .validation_tombstone_ms = 20,
        .active_send_items = @splat(1),
    };
    const layout = Layout.init(&options);
    var messages = Messages.init(a, &options, &layout) catch unreachable;
    defer messages.deinit(a, &peers);
    const source = peers.admit(.{ .index = 0, .generation = 1 }, &.{ .identity = .{ .bytes = @splat(1) }, .address = .unspecified, .direction = .inbound }, 0).admitted.peer;
    const duplicate = peers.admit(.{ .index = 1, .generation = 1 }, &.{ .identity = .{ .bytes = @splat(2) }, .address = .unspecified, .direction = .inbound }, 0).admitted.peer;
    var handles: [16]gossip.Gossipsub.ValidationHandle = @splat(.{ .index = 0, .generation = 0 });
    var deliveries = gossip.delivery.Pool.init(a, 3, gossip.delivery.Pool.capacity(3, 1)) catch unreachable;
    defer deliveries.deinit(a);
    var outboxes: [3]Outbox = @splat(.{
        .control = .{ .bytes = &.{} },
        .critical = .{ .bytes = &.{} },
        .data = .{ .pool = &deliveries },
        .active_send_timeout_ms = 12,
        .queue_timeout_ms = 30,
    });
    defer for (&outboxes) |*outbox| outbox.cancelStream();
    const senders = a.alloc(u16, messages.store.entries.len) catch unreachable;
    defer a.free(senders);
    var now: u64 = 1;
    var epoch: u64 = 0;
    var payload: [payload_max]u8 = @splat(9);
    for (input[0..len], 0..) |byte, step| {
        const at = byte / 16;
        const store = &messages.store;
        const validation = &messages.validation;
        switch (byte % 10) {
            0, 1 => {
                var id: gossip.Gossipsub.MessageId = @splat(0);
                std.mem.writeInt(u64, id[0..8], step + 1, .little);
                if (validation.available()) {
                    if (messages.history.admitPayload(store, .beacon_block, id, "/eth2/01020304/beacon_block/ssz_snappy", payload[0 .. 1 + @as(usize, at) * (payload_max / 16)])) |message| {
                        handles[at] = validation.admit(store, &peers, message, source, 0, now);
                        store.seal(message);
                    }
                }
            },
            2, 3 => if (validation.inspect(store, &peers, handles[at], now) == null) {
                const handle = handles[at];
                if (byte % 10 == 2) messages.history.put(store, validation.entries[handle.index].state.pending.message, 0, epoch);
                validation.finish(store, &peers, handle, if (byte % 10 == 2) .accept else .ignore, now);
            },
            4 => {
                now += 1 + at;
                messages.expire(&peers, now);
                for (&outboxes) |*outbox| if (outbox.active_deadline_ms) |deadline| {
                    if (now >= deadline) outbox.cancelStream();
                };
            },
            5 => {
                epoch += 1;
                messages.history.age(store, epoch);
            },
            6 => {
                const index = at % store.entries.len;
                const entry = &store.entries[index];
                if (entry.active and entry.history) {
                    const handle: Handle = .{ .index = @intCast(index), .generation = entry.generation };
                    _ = outboxes[at % outboxes.len].queueData(store, handle, .forward, .{ .bytes = 2 * payload_max }, now);
                }
            },
            7 => {
                const outbox = &outboxes[at % outboxes.len];
                if (byte < 128) {
                    outbox.cancelStream();
                } else {
                    const segment = outbox.segment(store, now);
                    if (segment.len > 0) _ = outbox.advance(if (byte & 32 != 0) segment.len else @min(1 + at, segment.len));
                }
            },
            8 => if (validation.inspect(store, &peers, handles[at], now) == null) {
                _ = Validation.duplicate(validation.attribution(handles[at]), &peers, duplicate, byte < 128);
            },
            9 => {
                outboxes[0].cancelStream();
                peers.scores.penalize(source.index, 7);
                peers.disconnect(source, now);
                const admitted = peers.admit(.{ .index = 0, .generation = @intCast(step + 2) }, &.{ .identity = .{ .bytes = @splat(1) }, .address = .unspecified, .direction = .inbound }, now).admitted;
                assert(std.meta.eql(source, admitted.peer));
            },
            else => unreachable,
        }
        var pages: usize = 0;
        var entries: usize = 0;
        var history: usize = 0;
        var pending: usize = 0;
        var pins: [9]u32 = @splat(0);
        @memset(senders, 0);
        for (&outboxes) |*outbox| if (outbox.active == .data and outbox.active.data == .shared) {
            const message = outbox.active.data.shared.message;
            assert(store.get(message) != null);
            senders[message.index] += 1;
        };
        var sending_entries: usize = 0;
        var sending_pages: usize = 0;
        for (store.entries, senders) |entry, expected_senders| {
            assert(entry.senders == expected_senders);
            if (!entry.active) continue;
            assert(!entry.provisional);
            assert(entry.validation or entry.history or entry.senders > 0);
            pages += Store.pagesFor(entry.len);
            entries += 1;
            history += @intFromBool(entry.history);
            pending += @intFromBool(entry.validation);
            if (entry.senders > 0) {
                sending_entries += 1;
                sending_pages += Store.pagesFor(entry.len);
            }
        }
        const kind = @intFromEnum(gossip.topic.Kind.beacon_block);
        assert(sending_entries == store.sending_entries_by_kind[kind]);
        assert(sending_pages == store.sending_by_kind[kind]);
        var queued: usize = 0;
        var protected: usize = outboxes.len * gossip.delivery.per_peer_reserve;
        for (&outboxes) |*outbox| {
            const queue = &outbox.data;
            queued += queue.count;
            protected -= @min(queue.count, gossip.delivery.per_peer_reserve);
        }
        assert(queued + deliveries.available == deliveries.slots.len);
        assert(protected == deliveries.protected and deliveries.available >= protected);
        assert(pages + store.free_pages == store.next.len);
        assert(entries == store.used_entries);
        assert(history == messages.history.count);
        var records: usize = 0;
        for (validation.recent) |record| {
            if (record.state != .pending) continue;
            records += 1;
            assert(peers.matches(record.source));
            pins[record.source.index] += 1;
            for (record.duplicates[0..record.duplicate_len]) |peer| {
                assert(peers.matches(peer.peer));
                pins[peer.peer.index] += 1;
            }
        }
        assert(records == pending);
        for (peers.rows, pins) |peer, expected| assert(peer.pins == expected);
    }
    messages.validation.clear(&messages.store, &peers);
    for (&outboxes) |*outbox| outbox.cancelStream();
    messages.history.age(&messages.store, epoch + gossip.constants.mcache_len);
    assert(messages.store.used_entries == 0);
    assert(messages.store.free_pages == messages.store.next.len);
    for (peers.rows) |peer| assert(peer.pins == 0);
}
