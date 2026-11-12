const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const fixture = @import("gossip_fixture");
const network = @import("network");
const gossip = network.gossipsub;
const processor = network.gossip_processor;
const Table = processor.GossipProcessor;
const Store = @FieldType(Table, "store");
const Kind = processor.limits.Kind;
const Harness = fixture.Harness;
const assert = std.debug.assert;
const input_max = 4096;
const steps_max = 2048;
const kind_count = processor.limits.kind_count;
const delivered_max = 256;
const roots_known = 4;
const topics = fixture.topics[0..7];

const limits: processor.limits.Limits = blk: {
    var result: processor.limits.Limits = @splat(.{ .items = 2, .bytes = 8192 });
    result[@intFromEnum(Kind.beacon_block)] = .{ .items = 4, .bytes = 65536 };
    result[@intFromEnum(Kind.beacon_attestation)] = .{ .items = 16, .bytes = 65536 };
    result[@intFromEnum(Kind.beacon_aggregate_and_proof)] = .{ .items = 8, .bytes = 32768 };
    result[@intFromEnum(Kind.sync_committee)] = .{ .items = 4, .bytes = 16384 };
    break :blk result;
};

const Consumer = struct {
    sink: gossip.Gossipsub.MessageSink = undefined,
    table: *Table,
    slot: u64 = 100,

    fn attach(self: *Consumer, g: *gossip.Gossipsub) void {
        self.sink = .{ .context = self, .has_capacity = hasCapacity, .admit = admit };
        g.message_sink = &self.sink;
    }

    fn hasCapacity(context: *anyopaque, kind: Kind, len: usize) bool {
        const self: *Consumer = @ptrCast(@alignCast(context));
        return self.table.checkAdmissionCapacity(kind, len);
    }

    fn admit(context: *anyopaque, candidate: *gossip.Gossipsub.MessageAdmission) bool {
        const self: *Consumer = @ptrCast(@alignCast(context));
        return self.table.admit(candidate, candidate.event.admitted_ms, candidate.event.admitted_ms, self.slot);
    }
};

fn root(index: usize) [32]u8 {
    var value: [32]u8 = @splat(0);
    value[0] = @intCast(index + 1);
    value[31] = 0xaa;
    return value;
}

/// Lays out slot, root and group bytes where `metadata.extract` reads them for the kind.
fn payloadFor(buffer: []u8, kind: Kind, size: usize, filler: u8, seed: u64, slot: u64, root_index: usize) []u8 {
    const len = @min(size, buffer.len);
    const payload = buffer[0..len];
    @memset(payload, filler);
    if (len >= 8) std.mem.writeInt(u64, payload[0..8], seed, .little);
    const offset: usize = switch (kind) {
        .beacon_block => 100,
        .beacon_attestation => 16,
        .beacon_aggregate_and_proof => 212,
        else => return payload,
    };
    if (len >= offset + 8) std.mem.writeInt(u64, payload[offset..][0..8], slot, .little);
    if (len >= offset + 48) payload[offset + 16 ..][0..32].* = root(root_index);
    return payload;
}

fn checkProcessor(table: *const Table) void {
    var used_items: [kind_count]usize = @splat(0);
    var used_bytes: [kind_count]usize = @splat(0);
    var waiting: [kind_count]usize = @splat(0);
    var executing_items: [kind_count]usize = @splat(0);
    var executing_bytes: [kind_count]usize = @splat(0);
    var source_items: [gossip.constants.retained_peers_cap][kind_count]u32 = @splat(@splat(0));
    var source_bytes: [gossip.constants.retained_peers_cap][kind_count]usize = @splat(@splat(0));
    var source_waiting: [gossip.constants.retained_peers_cap][kind_count]u16 = @splat(@splat(0));
    var occupied: usize = 0;
    var queued: usize = 0;
    var checking: usize = 0;
    var copying: usize = 0;
    var copying_bytes: usize = 0;
    var pending_completions: usize = 0;
    var payload_bytes: usize = 0;
    var handles: usize = 0;
    const page_bytes = table.store.bytes.len / table.store.next.len;
    for (table.cells) |*cell| {
        if (cell.state == .free) {
            assert(!cell.executing and cell.input.handle == null);
            continue;
        }
        const k = @intFromEnum(cell.kind);
        occupied += 1;
        used_items[k] += 1;
        switch (cell.state) {
            .queued => queued += 1,
            .waiting => waiting[k] += 1,
            .needs_check, .checking => checking += 1,
            .copying => {
                copying += 1;
                copying_bytes += cell.input.len;
            },
            .completion_pending => pending_completions += 1,
            .delivered => {},
            .free => unreachable,
        }
        if (cell.input.handle) |handle| {
            assert(table.store.get(handle) != null);
            handles += 1;
            used_bytes[k] += Store.pagesFor(cell.input.len) * page_bytes;
            payload_bytes += cell.input.len;
        } else assert(cell.input.len == 0);
        if (cell.executing) {
            executing_items[k] += 1;
            executing_bytes[k] += cell.execution_bytes;
        }
        if (cell.source) |source| {
            if (table.sources[source.index].generation == source.generation) {
                if (cell.source_charge > 0) {
                    source_items[source.index][k] += 1;
                    source_bytes[source.index][k] += cell.source_charge;
                }
                if (cell.state == .waiting) source_waiting[source.index][k] += 1;
            }
        }
    }
    assert(occupied == table.diag.occupied);
    assert(queued == table.diag.queued);
    assert(checking == table.diag.checking);
    assert(copying == table.diag.copying);
    assert(copying_bytes == table.diag.copyingBytes);
    assert(pending_completions == table.diag.pendingCompletions);
    assert(payload_bytes == table.diag.payloadBytes);
    assert(handles == table.store.used_entries);
    var waiting_total: usize = 0;
    var executing_total: usize = 0;
    var executing_bytes_total: usize = 0;
    for (0..kind_count) |k| {
        assert(used_items[k] == table.used_items[k]);
        assert(used_bytes[k] == table.used_bytes[k]);
        assert(waiting[k] == table.waiting_items[k]);
        assert(executing_items[k] == table.executing_items[k]);
        assert(executing_bytes[k] == table.executing_bytes[k]);
        assert(used_items[k] <= table.limits[k].items and used_bytes[k] <= table.limits[k].bytes);
        waiting_total += waiting[k];
        executing_total += executing_items[k];
        executing_bytes_total += executing_bytes[k];
    }
    assert(waiting_total == table.diag.waiting);
    assert(executing_total == table.diag.executing);
    assert(executing_bytes_total == table.diag.executingBytes);
    for (table.sources, 0..) |usage, s| for (0..kind_count) |k| {
        assert(usage.items[k] == source_items[s][k]);
        assert(usage.bytes[k] == source_bytes[s][k]);
        assert(usage.waiting[k] == source_waiting[s][k]);
    };
}

/// Applies processor completions to gossipsub, at most `limit` per call.
fn pumpCompletions(table: *Table, h: *Harness, limit: usize) void {
    for (0..limit) |_| {
        const token = table.nextCompletion() orelse break;
        const cell = table.get(token).?;
        switch (cell.completion) {
            .verdict => |verdict| table.outcome(h.g.report(cell.handle, verdict, h.now())),
            .cancelled => _ = h.g.cancel(cell.handle, h.now()),
        }
        table.retire(token);
    }
}

var harness: Harness = undefined;
var processor_table: Table = undefined;
var processor_consumer: Consumer = undefined;

/// Snapshot mode: this runs once before the fork server, so every input starts from this state.
pub export fn zig_fuzz_init() callconv(.c) void {
    harness.init(std.heap.c_allocator, .{ .peers = 6, .retained = 13, .validation = 64 }) catch @panic("gossip harness initialization failed");
    processor_table = Table.init(std.heap.c_allocator, .{ .limits = limits, .forks = &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }}, .random_seed = 7 }) catch @panic("processor initialization failed");
    processor_consumer = .{ .table = &processor_table };
    processor_consumer.attach(&harness.g);
}

pub export fn zig_fuzz_test(input: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0 or len > input_max) return;
    var imported: [roots_known]bool = @splat(false);
    var delivered: [delivered_max]Table.Token = undefined;
    var delivered_len: usize = 0;
    var payload: [fixture.payload_max]u8 = undefined;
    var copy: [fixture.payload_max]u8 = undefined;
    var cursor: fixture.Cursor = .{ .bytes = input[0..len] };
    var steps: usize = 0;
    while (cursor.next()) |op| : (steps += 1) {
        if (steps == steps_max) break;
        const peer = cursor.byte();
        const arg = cursor.byte();
        switch (op % 16) {
            0 => _ = harness.addPeer(peer),
            1 => harness.closePeer(peer),
            2 => {
                const topic = topics[arg % topics.len];
                const kind: Kind = switch (arg % topics.len) {
                    0 => .beacon_block,
                    1, 2 => .beacon_attestation,
                    3 => .beacon_aggregate_and_proof,
                    else => .sync_committee,
                };
                const shape = cursor.byte();
                const size = 1 + @as(usize, cursor.byte()) * 29;
                const delta = @as(u64, shape % 48);
                const message_slot = (processor_consumer.slot + 3) -| delta;
                const root_index = @as(usize, shape / 48) % (roots_known + 2);
                const seed: u64 = if (arg & 128 == 128) arg / 8 else harness.counter +% 0x7a3;
                harness.counter += 1;
                _ = harness.deliver(peer, topic, payloadFor(&payload, kind, size, arg, seed, message_slot, root_index));
            },
            3 => {
                const batch = processor_table.claimChecks(harness.now_ms, 1 + @as(usize, arg) % Table.batch_max);
                for (batch.tokens[0..batch.len]) |token| {
                    const cell = processor_table.get(token).?;
                    const known = cell.metadata.root orelse continue;
                    const index = @as(usize, known[0]) -| 1;
                    const available = (index < roots_known and imported[index]) or (arg & 1 == 1 and known[0] % 7 == 0);
                    _ = processor_table.classify(token, available);
                }
            },
            4 => {
                const batch = processor_table.claimDemand(harness.now_ms, .{ .items = 1 + @as(usize, arg) % Table.batch_max, .ordinary = arg & 1 == 1 });
                for (batch.tokens[0..batch.len]) |token| {
                    const cell = processor_table.get(token).?;
                    assert(cell.state == .copying and cell.input.len <= copy.len);
                    if (arg & 2 == 2) processor_table.copyPayload(cell, copy[0..cell.input.len]);
                }
                processor_table.finish(&batch);
                for (batch.tokens[0..batch.len]) |token| {
                    if (delivered_len == delivered_max) break;
                    delivered[delivered_len] = token;
                    delivered_len += 1;
                }
            },
            5 => if (delivered_len > 0) {
                const at = @as(usize, arg) % delivered_len;
                const token = delivered[at];
                delivered_len -= 1;
                delivered[at] = delivered[delivered_len];
                _ = processor_table.report(token, switch (peer % 3) {
                    0 => .accept,
                    1 => .reject,
                    else => .ignore,
                }, harness.now_ms);
            },
            6 => pumpCompletions(&processor_table, &harness, 1 + @as(usize, arg) % Table.batch_max),
            7 => {
                harness.advance(1 + @as(u64, arg));
                if (arg % 4 == 0) processor_consumer.slot += 1;
                processor_table.maintain(harness.now_ms, processor_consumer.slot);
            },
            8 => processor_table.expire(harness.now_ms),
            9 => {
                const index = @as(usize, arg) % roots_known;
                imported[index] = true;
                processor_table.notifyBlock(root(index));
            },
            10 => processor_table.dropQueued(),
            11 => processor_table.dropPeer(&Harness.identity(@as(usize, peer) % harness.g.options.connected_capacity)),
            12 => harness.drain(peer, 1 + @as(usize, arg) * 16),
            13 => harness.penalize(peer, @as(f64, @floatFromInt(arg))),
            14 => harness.cancelWrites(peer),
            15 => {
                harness.advance(1000 + @as(u64, arg) * 20);
                processor_consumer.slot += 1 + @as(u64, arg) % 70;
                processor_table.maintain(harness.now_ms, processor_consumer.slot);
            },
            else => unreachable,
        }
        if (steps % 8 == 7) {
            checkProcessor(&processor_table);
            harness.checkInvariants();
        }
    }
    checkProcessor(&processor_table);
    harness.checkInvariants();
    processor_table.close();
    pumpCompletions(&processor_table, &harness, processor_table.cells.len);
    for (delivered[0..delivered_len]) |token| _ = processor_table.report(token, .ignore, harness.now_ms);
    pumpCompletions(&processor_table, &harness, processor_table.cells.len);
    checkProcessor(&processor_table);
    assert(processor_table.diag.occupied == 0);
    // The fork child ends with the teardown checks; the kernel reclaims its copy of the snapshot.
    processor_table.deinit();
    harness.settle();
}
