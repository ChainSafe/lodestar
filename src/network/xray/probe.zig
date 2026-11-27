//! One exporter owns the collector socket and replay. The network owner only copies into Capture.
//! Stop the network producer before finish(); the exporter has one second to flush and join.
const std = @import("std");
const trace = @import("../stream_trace.zig");
const wire = @import("wire.zig");
const socket = @import("socket.zig");
const Replay = @import("replay.zig").Replay;
const Protocol = @import("../protocol.zig").Protocol;
const PeerId = @import("../wire/peer_id.zig").PeerId;
const metrics = @import("../metrics/registry.zig");

pub const Endpoint = socket.Endpoint;
const send_bytes_max = 1024 * 1024;
const Error = socket.Error || wire.Error;
const ErrorKind = enum { XRAY_COLLECTOR_UNAVAILABLE, XRAY_CAPTURE_GAP };

pub const Probe = struct {
    capture: trace.Capture,
    replay: Replay,
    io: std.Io,
    endpoint: Endpoint,
    peer: PeerId,
    client: [256]u8,
    client_len: usize,
    boot: [16]u8,
    started: u64,
    frame: wire.Frame = .{},
    sending: [send_bytes_max]u8 = undefined,
    thread: ?std.Thread = null,
    stop_at: std.atomic.Value(i64) = .init(std.math.maxInt(i64)),
    attached: std.atomic.Value(bool) = .init(false),
    first_attach: std.Io.Event = .unset,
    replay_bytes: std.atomic.Value(usize) = .init(0),
    pending_events: std.atomic.Value(u64) = .init(0),
    sent_bytes: std.atomic.Value(u64) = .init(0),
    errors: [std.meta.fields(ErrorKind).len]std.atomic.Value(u64) = @splat(.init(0)),
    snapshot_required: bool = false,

    pub fn allocatedBytesFor(connections: u16) usize {
        return @sizeOf(Probe) + trace.Capture.allocatedBytesFor(connections) - @sizeOf(trace.Capture) + Replay.allocated_bytes;
    }

    pub fn create(a: std.mem.Allocator, io: std.Io, connections: u16, endpoint: *const Endpoint, peer: *const PeerId, client: []const u8) !*Probe {
        std.debug.assert(client.len <= 256);
        const self = try a.create(Probe);
        errdefer a.destroy(self);
        self.* = .{
            .capture = try trace.Capture.init(a, io, connections),
            .replay = undefined,
            .io = io,
            .endpoint = endpoint.*,
            .peer = peer.*,
            .client = undefined,
            .client_len = client.len,
            .boot = undefined,
            .started = @intCast(@max(0, std.Io.Timestamp.now(io, .real).nanoseconds)),
        };
        errdefer self.capture.deinit(a);
        self.replay = try Replay.init(a);
        errdefer self.replay.deinit(a);
        @memcpy(self.client[0..client.len], client);
        try io.randomSecure(&self.boot);
        self.thread = try std.Thread.spawn(.{}, run, .{self});
        self.thread.?.setName(io, "xray-exporter") catch {};
        return self;
    }

    pub fn finish(self: *Probe) void {
        if (self.thread) |thread| {
            self.capture.close();
            self.stop_at.store(socket.now(self.io) + 1000, .release);
            self.capture.ready.set(self.io);
            thread.join();
            self.thread = null;
        }
    }

    pub fn waitForAttach(self: *Probe) error{XrayAttachTimeout}!void {
        const deadline = socket.now(self.io) + 30_000;
        while (!self.first_attach.isSet()) {
            const left = deadline - socket.now(self.io);
            if (left <= 0) return error.XrayAttachTimeout;
            self.first_attach.waitTimeout(self.io, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(@intCast(left)) } }) catch {};
        }
    }

    pub fn destroy(self: *Probe, a: std.mem.Allocator) void {
        self.finish();
        self.replay.deinit(a);
        self.capture.deinit(a);
        a.destroy(self);
    }

    pub fn writeMetrics(self: *Probe, out: *metrics.Encoder) metrics.Error!void {
        const stats = self.capture.stats();
        try out.scalar(.{ .name = "lodestar_xray_buffered_bytes", .help = "Bytes retained in native capture and replay", .kind = .gauge, .unit = .bytes }, stats.buffered_bytes + self.replay_bytes.load(.monotonic));
        try out.scalar(.{ .name = "lodestar_xray_dropped_bytes_total", .help = "Stream bytes discarded by native capture", .kind = .counter, .unit = .bytes }, stats.dropped_bytes);
        try out.scalar(.{ .name = "lodestar_xray_pending_events", .help = "Encoded events awaiting collector submission", .kind = .gauge }, self.pending_events.load(.monotonic));
        try out.scalar(.{ .name = "lodestar_xray_sent_bytes_total", .help = "Encoded bytes submitted to the collector", .kind = .counter, .unit = .bytes }, self.sent_bytes.load(.monotonic));
        try out.scalar(.{ .name = "lodestar_xray_connected", .help = "Collector handshake complete", .kind = .gauge }, @intFromBool(self.attached.load(.acquire)));
        const family = try out.family(.{ .name = "lodestar_xray_errors_total", .help = "Collector failures and capture gaps", .kind = .counter, .labels = &.{"code"} });
        inline for (std.meta.fields(ErrorKind), &self.errors) |kind, *count| try family.sample(.{kind.name}, count.load(.monotonic));
    }

    fn report(self: *Probe, kind: ErrorKind) void {
        _ = self.errors[@intFromEnum(kind)].fetchAdd(1, .monotonic);
    }

    fn run(self: *Probe) void {
        var retry_at: i64 = 0;
        var cursor: u64 = 1;
        var connection: ?socket.Socket = null;
        defer if (connection) |*live| live.close();
        defer self.attached.store(false, .release);
        while (socket.now(self.io) < self.stop_at.load(.acquire)) {
            const batch = self.capture.drain();
            if (batch.reset) {
                self.replay.clear();
                self.snapshot_required = true;
                self.report(.XRAY_CAPTURE_GAP);
            } else {
                for (batch.events) |*event| {
                    if (event.payload == .connection) self.replay.append(self.frame.peer(event, self.replay.last_sequence + 1));
                    self.replay.append(self.frame.event(event, batch.data, self.replay.last_sequence + 1, false));
                }
            }
            self.replay_bytes.store(self.replay.byte_len, .monotonic);
            self.pending_events.store(self.replay.last_sequence + 1 - @min(cursor, self.replay.last_sequence + 1), .monotonic);
            if (connection == null and socket.now(self.io) >= retry_at) {
                connection = self.connect(&cursor) catch blk: {
                    self.report(.XRAY_COLLECTOR_UNAVAILABLE);
                    retry_at = socket.now(self.io) + 1000;
                    break :blk null;
                };
            }
            if (connection) |*live| {
                self.send(live, &cursor) catch {
                    live.close();
                    connection = null;
                    self.attached.store(false, .release);
                    self.report(.XRAY_COLLECTOR_UNAVAILABLE);
                    retry_at = socket.now(self.io) + 1000;
                };
            }
            const caught_up = cursor == self.replay.last_sequence + 1;
            if (self.stop_at.load(.acquire) != std.math.maxInt(i64) and !batch.pending and (connection == null or caught_up)) return;
            if (!batch.pending and (connection == null or caught_up))
                self.capture.ready.waitTimeout(self.io, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(20) } }) catch {};
        }
    }

    fn connect(self: *Probe, cursor: *u64) Error!socket.Socket {
        const live = try socket.Socket.connect(&self.endpoint, self.io, &self.stop_at);
        errdefer live.close();
        const acked = try live.handshake(self.frame.hello(&self.peer, self.client[0..self.client_len], &self.boot, self.started));
        if (acked > self.replay.last_sequence) return error.InvalidHandshake;
        cursor.* = acked + 1;
        if (!self.snapshot_required and self.replay.covers(cursor.*)) {
            if (acked == 0) try self.snapshot(&live, &.{}, 0);
        } else {
            if (!self.snapshot_required) self.report(.XRAY_CAPTURE_GAP);
            try self.resnapshot(&live, cursor);
        }
        self.attached.store(true, .release);
        self.first_attach.set(self.io);
        return live;
    }

    fn write(self: *Probe, live: *const socket.Socket, bytes: []const u8) Error!void {
        try live.write(bytes);
        _ = self.sent_bytes.fetchAdd(bytes.len, .monotonic);
    }

    fn snapshot(self: *Probe, live: *const socket.Socket, events: []const trace.Event, sequence: u64) Error!void {
        try self.write(live, self.frame.snapshot(null));
        for (1..Protocol.count + 3) |index| try self.write(live, self.frame.string(@intCast(index)));
        for (events) |*event| {
            if (event.payload == .connection) try self.write(live, self.frame.peer(event, 0));
            try self.write(live, self.frame.event(event, &.{}, 0, true));
        }
        try self.write(live, self.frame.snapshot(sequence));
    }

    fn resnapshot(self: *Probe, live: *const socket.Socket, cursor: *u64) Error!void {
        self.snapshot_required = true;
        self.capture.invalidate(0);
        const batch = self.capture.drain();
        self.replay.clear();
        try self.snapshot(live, batch.events, self.replay.last_sequence);
        cursor.* = self.replay.last_sequence + 1;
        self.snapshot_required = false;
    }

    fn send(self: *Probe, live: *const socket.Socket, cursor: *u64) Error!void {
        try live.checkConnected();
        if (self.snapshot_required or !self.replay.covers(cursor.*)) {
            if (!self.snapshot_required) self.report(.XRAY_CAPTURE_GAP);
            try self.resnapshot(live, cursor);
        }
        var length: usize = 0;
        var next = cursor.*;
        for (0..512) |_| {
            const copied = self.replay.copy(next, self.sending[length..]) orelse break;
            length += copied;
            next += 1;
        }
        if (length > 0) try self.write(live, self.sending[0..length]);
        cursor.* = next;
    }
};

test {
    _ = @import("probe_test.zig");
}
