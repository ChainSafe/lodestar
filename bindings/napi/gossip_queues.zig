//! Each node owns one queue. Only its creating environment may drain or close it.
//! Ingress environments address it by a non-recycled id, never a pointer or a JS reference.
const std = @import("std");
const js = @import("zapi:zapi").js;
const napi = @import("zapi:zapi").napi;
const Processor = @import("gossip_processor");
const alloc = std.heap.c_allocator;
const Queue = struct {
    id: u32,
    owner: napi.c.napi_env,
    table: Processor,
    signalled: bool = false,
    next: ?*Queue,
};
var lock: std.Io.Mutex = .init;
var head: ?*Queue = null;
var next_id: u32 = 0;
var count: usize = 0;
const max_queues = 64;

fn lookup(id: u32, owner_only: bool) !*Queue {
    var cursor = head;
    for (0..count) |_| {
        const q = cursor.?;
        if (q.id == id) {
            if (owner_only and q.owner != js.env().env) return error.WrongGossipQueueOwner;
            return q;
        }
        cursor = q.next;
    }
    return error.GossipQueueClosed;
}
fn nowMs() u64 {
    return @intCast(std.Io.Clock.awake.now(js.io()).toMilliseconds());
}
pub fn create(validators: js.Number, concurrency: js.Number) !js.Number {
    const validator_count = try validators.toU32Exact();
    const max_executing = try concurrency.toU32Exact();
    if (max_executing == 0) return error.InvalidGossipQueueConfig;
    const limits = Processor.policy.queueLimits(validator_count);
    var seed: u64 = undefined;
    js.io().random(std.mem.asBytes(&seed));
    lock.lockUncancelable(js.io());
    defer lock.unlock(js.io());
    if (count == max_queues or next_id == std.math.maxInt(u32)) return error.TooManyGossipQueues;
    const q = try alloc.create(Queue);
    errdefer alloc.destroy(q);
    q.* = .{ .id = next_id + 1, .owner = js.env().env, .table = try Processor.init(alloc, limits, seed), .next = head };
    errdefer q.table.deinit();
    q.table.execution = Processor.policy.executionLimits(&limits, max_executing);
    try js.env().addEnvCleanupHook(Queue, q, cleanup);
    next_id = q.id;
    head = q;
    count += 1;
    return js.Number.from(q.id);
}
fn remove(target: *Queue) void {
    var link = &head;
    for (0..count) |_| {
        const q = link.*.?;
        if (q == target) {
            link.* = q.next;
            q.table.deinit();
            alloc.destroy(q);
            count -= 1;
            return;
        }
        link = &q.next;
    }
    unreachable;
}
fn cleanup(q: *Queue) void {
    lock.lockUncancelable(js.io());
    defer lock.unlock(js.io());
    remove(q);
}
pub fn close(id_arg: js.Number) !void {
    const id = try id_arg.toU32Exact();
    lock.lockUncancelable(js.io());
    defer lock.unlock(js.io());
    const q = lookup(id, true) catch |err| switch (err) {
        error.GossipQueueClosed => return,
        else => return err,
    };
    try js.env().removeEnvCleanupHook(Queue, q, cleanup);
    remove(q);
}
fn peerKey(value: js.String) !Processor.Peer {
    var buf: [129]u8 = undefined;
    const bytes = try value.toSlice(&buf);
    if (bytes.len == 0 or bytes.len == buf.len - 1 and try value.len() > 128 or std.mem.indexOfScalar(u8, bytes, 0) != null) return error.InvalidGossipPeer;
    var key: Processor.Peer = @splat(0);
    @memcpy(key[0..bytes.len], bytes);
    return key;
}
fn parseKind(value: js.String) !Processor.Kind {
    var buf: [64]u8 = undefined;
    return std.meta.stringToEnum(Processor.Kind, try value.toSlice(&buf)) orelse error.InvalidGossipKind;
}
pub fn offer(
    id_arg: js.Number,
    kind_arg: js.String,
    fork_arg: js.Number,
    digest_arg: js.Number,
    peer_arg: js.String,
    context_arg: js.String,
    data_arg: js.Uint8Array,
    slot_arg: js.Number,
    latest_arg: js.Number,
) !js.Boolean {
    const id = try id_arg.toU32Exact();
    const kind = try parseKind(kind_arg);
    const fork = std.enums.fromInt(Processor.ForkSeq, try fork_arg.toU32Exact()) orelse return error.InvalidFork;
    var digest: [4]u8 = undefined;
    std.mem.writeInt(u32, &digest, try digest_arg.toU32Exact(), .big);
    const peer = try peerKey(peer_arg);
    var context_buffer: [Processor.policy.context_max + 2]u8 = undefined;
    const context = try context_arg.toSlice(&context_buffer);
    if (context.len > Processor.policy.context_max) return error.InvalidGossipReceipt;
    const bytes = try data_arg.toSlice();
    const slot = try slot_arg.toSafeInteger();
    const latest = try latest_arg.toSafeInteger();
    lock.lockUncancelable(js.io());
    defer lock.unlock(js.io());
    const q = lookup(id, false) catch return js.Boolean.from(false);
    const now = nowMs();
    q.table.expire(now);
    const accepted = try q.table.admit(.{
        .kind = kind,
        .fork = fork,
        .digest = digest,
        .peer = peer,
        .context = context,
        .bytes = bytes,
        .slot = slot,
        .latest = latest,
        .now = now,
        .deadline = now + 30_000,
    });
    const wake = accepted and !q.signalled;
    q.signalled = q.signalled or wake;
    return js.Boolean.from(wake);
}
fn copyBytes(bytes: []const u8) !napi.Value {
    const array = try js.Uint8Array.alloc(bytes.len);
    @memcpy(try array.toSlice(), bytes);
    return array.val;
}
fn tokenValue(token: Processor.Token) napi.Value {
    return js.BigInt.from((@as(u64, token.generation) << 16) | token.index).toValue();
}
fn parseToken(value: js.BigInt) !Processor.Token {
    const encoded = try value.toU64Exact();
    return .{ .index = @truncate(encoded), .generation = encoded >> 16 };
}
const Check = struct {
    token: Processor.Token,
    peer: Processor.Peer,
    kind: Processor.Kind,
    slot: u64,
    root: [32]u8,
    parent: ?[32]u8,
    payload: bool,
};
const Delivery = struct {
    token: Processor.Token,
    context: []const u8,
    data: []const u8,
    slot: ?u64,
    group: ?Processor.AttestationDataBytes,
};
const Selection = struct {
    checks: [Processor.batch_max]Check = undefined,
    check_count: usize = 0,
    messages: [Processor.batch_max]Delivery = undefined,
    batch: Processor.Batch = .{},
    delay: i64 = -1,

    fn release(self: *Selection) void {
        for (self.messages[0..self.batch.len]) |message| {
            alloc.free(message.context);
            alloc.free(message.data);
        }
    }
};
fn select(id: u32, slot: u64, ordinary: bool, result: *Selection) !void {
    lock.lockUncancelable(js.io());
    defer lock.unlock(js.io());
    const q = try lookup(id, true);
    const table = &q.table;
    q.signalled = false;
    const now = nowMs();
    table.maintain(now, slot);
    const checks = table.claimChecks(now, Processor.batch_max);
    for (checks.tokens[0..checks.len], 0..) |token, i| {
        const c = table.get(token).?;
        result.checks[i] = .{
            .token = token,
            .peer = c.peer,
            .kind = c.kind,
            .slot = c.metadata.slot.?,
            .root = c.metadata.root.?,
            .parent = c.metadata.parent_hash,
            .payload = c.metadata.payload_present,
        };
    }
    result.check_count = checks.len;
    result.batch = table.claimDemand(now, .{ .items = Processor.batch_max, .bytes = 8 * 1024 * 1024, .ordinary = ordinary });
    for (result.batch.tokens[0..result.batch.len], 0..) |token, i| {
        const c = table.get(token).?;
        const buffers = table.take(token);
        result.messages[i] = .{
            .token = token,
            .context = buffers.context,
            .data = buffers.data,
            .slot = c.metadata.slot,
            .group = c.metadata.group,
        };
    }
    table.finish(&result.batch);
    const ready = table.readiness();
    if (table.pending() or ready.checks or ready.urgent or (ordinary and ready.ordinary)) {
        result.delay = 0;
    } else if (table.deadline()) |deadline| result.delay = @intCast(deadline -| now);
}
pub fn drain(id_arg: js.Number, slot_arg: js.Number, ready_arg: js.Boolean) !js.Value {
    const id = try id_arg.toU32Exact();
    var selection: Selection = .{};
    try select(id, try slot_arg.toSafeInteger(), try ready_arg.toBool(), &selection);
    defer selection.release();
    errdefer {
        lock.lockUncancelable(js.io());
        defer lock.unlock(js.io());
        if (lookup(id, true)) |q| {
            for (selection.checks[0..selection.check_count]) |check| if (q.table.get(check.token)) |c| {
                if (c.state == .checking) q.table.cancel(c);
            };
            for (selection.batch.tokens[0..selection.batch.len]) |token| if (q.table.get(token)) |_| q.table.retire(token);
        } else |_| {}
    }
    const env = js.env();
    const out = try env.createObject();
    const checks = try env.createArrayWithLength(selection.check_count);
    for (selection.checks[0..selection.check_count], 0..) |check, i| {
        const obj = try env.createObject();
        try obj.setNamedProperty("token", tokenValue(check.token));
        try obj.setNamedProperty("peerId", try env.createStringUtf8(std.mem.sliceTo(&check.peer, 0)));
        try obj.setNamedProperty("kind", try env.createStringUtf8(@tagName(check.kind)));
        try obj.setNamedProperty("slot", js.Number.from(check.slot).val);
        try obj.setNamedProperty("root", try copyBytes(&check.root));
        try obj.setNamedProperty("parentBlockHash", if (check.parent) |v| try copyBytes(&v) else try env.getNull());
        try obj.setNamedProperty("payloadPresent", js.Boolean.from(check.payload).val);
        try checks.setElement(@intCast(i), obj);
    }
    const jobs = try env.createArrayWithLength(selection.batch.job_count);
    for (selection.batch.jobs[0..selection.batch.job_count], 0..) |job, j| {
        const messages = try env.createArrayWithLength(job.len);
        for (selection.messages[job.start..][0..job.len], 0..) |message, i| {
            const obj = try env.createObject();
            try obj.setNamedProperty("token", tokenValue(message.token));
            try obj.setNamedProperty("data", try copyBytes(message.data));
            try obj.setNamedProperty("context", try env.createStringUtf8(message.context));
            try obj.setNamedProperty("slot", if (message.slot) |slot| js.Number.from(slot).val else try env.getNull());
            try obj.setNamedProperty("group", if (message.group) |v| try copyBytes(&v) else try env.getNull());
            try messages.setElement(@intCast(i), obj);
        }
        try jobs.setElement(@intCast(j), messages);
    }
    try out.setNamedProperty("checks", checks);
    try out.setNamedProperty("jobs", jobs);
    try out.setNamedProperty("delay", js.Number.from(selection.delay).val);
    return .{ .val = out };
}
pub fn classify(id_arg: js.Number, handle: js.BigInt, available_arg: js.Boolean) !void {
    const id = try id_arg.toU32Exact();
    const token = try parseToken(handle);
    const available = try available_arg.toBool();
    lock.lockUncancelable(js.io());
    defer lock.unlock(js.io());
    _ = (try lookup(id, true)).table.classify(token, available);
}
pub fn complete(id_arg: js.Number, handle: js.BigInt) !js.Boolean {
    const id = try id_arg.toU32Exact();
    const token = try parseToken(handle);
    lock.lockUncancelable(js.io());
    defer lock.unlock(js.io());
    const q = lookup(id, true) catch return js.Boolean.from(false);
    return js.Boolean.from(q.table.complete(token, nowMs()));
}
pub fn notify(id_arg: js.Number, root_arg: js.Uint8Array) !void {
    const id = try id_arg.toU32Exact();
    const root = try root_arg.toSlice();
    if (root.len != 32) return error.InvalidBlockRoot;
    lock.lockUncancelable(js.io());
    defer lock.unlock(js.io());
    (try lookup(id, true)).table.notifyBlock(root[0..32].*);
}
pub fn dropPeer(id_arg: js.Number, peer_arg: js.String) !void {
    const id = try id_arg.toU32Exact();
    const peer = try peerKey(peer_arg);
    lock.lockUncancelable(js.io());
    defer lock.unlock(js.io());
    (try lookup(id, true)).table.dropPeer(peer);
}
pub fn dropQueued(id_arg: js.Number) !void {
    const id = try id_arg.toU32Exact();
    lock.lockUncancelable(js.io());
    defer lock.unlock(js.io());
    (try lookup(id, true)).table.dropQueued();
}
const Snapshot = struct { context: []u8, data: []u8 };
fn freeSnapshot(list: *std.ArrayList(Snapshot)) void {
    for (list.items) |item| {
        alloc.free(item.context);
        alloc.free(item.data);
    }
    list.deinit(alloc);
}
fn snapshot(id: u32, kind: Processor.Kind) !std.ArrayList(Snapshot) {
    lock.lockUncancelable(js.io());
    defer lock.unlock(js.io());
    const table = &(try lookup(id, true)).table;
    var list: std.ArrayList(Snapshot) = .empty;
    errdefer freeSnapshot(&list);
    const queue = table.queues[@intFromEnum(kind)][@intFromEnum(Processor.State.queued)];
    try list.ensureTotalCapacity(alloc, queue.len);
    var index = queue.head;
    for (0..queue.len) |_| {
        const cell = &table.cells[index];
        index = cell.state_link.next;
        if (!table.queuedForDelivery(cell)) continue;
        const context = try alloc.dupe(u8, cell.context);
        errdefer alloc.free(context);
        list.appendAssumeCapacity(.{ .context = context, .data = try alloc.dupe(u8, cell.input) });
    }
    return list;
}
pub fn dump(id_arg: js.Number, kind_arg: js.String) !js.Array {
    const kind = try parseKind(kind_arg);
    var list = try snapshot(try id_arg.toU32Exact(), kind);
    defer freeSnapshot(&list);
    const env = js.env();
    const result = try env.createArrayWithLength(list.items.len);
    for (list.items, 0..) |item, i| {
        const obj = try env.createObject();
        try obj.setNamedProperty("context", try env.createStringUtf8(item.context));
        try obj.setNamedProperty("data", try copyBytes(item.data));
        try result.setElement(@intCast(i), obj);
    }
    return .{ .val = result };
}

pub fn stats(id_arg: js.Number) !js.Value {
    const id = try id_arg.toU32Exact();
    const Row = struct { queued: usize, executing: usize, keys: usize, dropped: u64 };
    var rows: [Processor.policy.kind_count]Row = undefined;
    {
        lock.lockUncancelable(js.io());
        defer lock.unlock(js.io());
        const table = &(try lookup(id, true)).table;
        for (std.enums.values(Processor.Kind), 0..) |kind, k| {
            rows[k] = .{
                .queued = table.queues[k][@intFromEnum(Processor.State.queued)].len,
                .executing = table.executing_items[k],
                .keys = if (kind == .beacon_attestation) table.groups.rows.len - table.groups.free.len else 1,
                .dropped = table.capacity_drops[k],
            };
        }
    }
    const env = js.env();
    const result = try env.createObject();
    inline for (std.meta.fields(Processor.Kind), 0..) |field, k| {
        const obj = try env.createObject();
        inline for (std.meta.fields(Row)) |metric| try obj.setNamedProperty(metric.name, js.Number.from(@field(rows[k], metric.name)).val);
        try result.setNamedProperty(field.name, obj);
    }
    return .{ .val = result };
}
