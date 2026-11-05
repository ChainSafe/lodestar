//! Optional capture of negotiated application streams. The producer copies accepted bytes;
//! the consumer drains copies without retaining network buffers. Overflow discards the capture
//! backlog and pauses bytes until a metadata snapshot marks live streams incomplete.
const std = @import("std");
const t = @import("types.zig");
const PeerId = @import("wire/peer_id.zig").PeerId;
const limits = @import("quic/limits.zig");
const Protocol = @import("protocol.zig").Protocol;

pub const chunk_max = 64 * 1024;
pub const drain_bytes_max = 1024 * 1024;
pub const drain_events_max = 512;
const events_max = 65536;
const bytes_max = 16 * 1024 * 1024;

pub const Connection = struct {
    id: u64,
    peer_alias: u64,
    peer: PeerId,
    remote: t.Address,
    local: t.Address,
    direction: t.Direction,
};
pub const Stream = struct {
    id: u64,
    connection: u64,
    protocol: Protocol,
    direction: t.Direction,
};
pub const Event = struct {
    observed_at_ns: u64,
    payload: union(enum) {
        connection: Connection,
        stream: Stream,
        data: struct { stream: u64, direction: t.Direction, offset: usize, length: usize },
        stream_closed: struct { stream: u64, reset: bool },
        connection_closed: u64,
    },
};
const ConnectionState = struct { handle: t.Handle = .{ .index = 0, .generation = 0 }, event: ?Event = null };
const StreamState = struct { handle: t.StreamHandle = undefined, event: ?Event = null };

pub const Batch = struct {
    events: []const Event,
    data: []const u8,
    reset: bool,
    pending: bool,
    buffered_bytes: usize,
    dropped_bytes: u64,
};

pub const Capture = struct {
    mutex: std.Io.Mutex = .init,
    ready: std.Io.Event = .unset,
    io: std.Io,
    connections: []ConnectionState,
    streams: []StreamState,
    events: []Event,
    bytes: []u8,
    output_events: []Event,
    output_bytes: []u8,
    head: usize = 0,
    len: usize = 0,
    byte_head: usize = 0,
    byte_len: usize = 0,
    gap: bool = false,
    dropped_bytes: u64 = 0,
    next_id: u64 = 1,

    pub fn allocatedBytesFor(connections_max: u16) usize {
        const streams = @as(usize, connections_max) * limits.streams_per_connection;
        return @sizeOf(Capture) + @as(usize, connections_max) * @sizeOf(ConnectionState) + streams * @sizeOf(StreamState) +
            (events_max + @max(drain_events_max, connections_max + streams)) * @sizeOf(Event) + bytes_max + drain_bytes_max;
    }

    pub fn init(a: std.mem.Allocator, io: std.Io, connections_max: u16) std.mem.Allocator.Error!Capture {
        std.debug.assert(connections_max > 0 and connections_max <= limits.connections_max_ceiling);
        const connections = try a.alloc(ConnectionState, connections_max);
        errdefer a.free(connections);
        const streams = try a.alloc(StreamState, @as(usize, connections_max) * limits.streams_per_connection);
        errdefer a.free(streams);
        const events = try a.alloc(Event, events_max);
        errdefer a.free(events);
        const bytes = try a.alloc(u8, bytes_max);
        errdefer a.free(bytes);
        const output_events = try a.alloc(Event, @max(drain_events_max, connections.len + streams.len));
        errdefer a.free(output_events);
        const output_bytes = try a.alloc(u8, drain_bytes_max);
        errdefer a.free(output_bytes);
        @memset(connections, .{});
        @memset(streams, .{});
        return .{ .io = io, .connections = connections, .streams = streams, .events = events, .bytes = bytes, .output_events = output_events, .output_bytes = output_bytes };
    }

    pub fn deinit(self: *Capture, a: std.mem.Allocator) void {
        a.free(self.output_bytes);
        a.free(self.output_events);
        a.free(self.bytes);
        a.free(self.events);
        a.free(self.streams);
        a.free(self.connections);
    }

    /// The producer must have stopped before closing the remaining captured connections.
    pub fn close(self: *Capture) void {
        for (self.connections) |state| if (state.event != null) self.disconnected(state.handle);
    }

    fn timestamp(self: *const Capture) u64 {
        return @intCast(@max(0, std.Io.Timestamp.now(self.io, .real).nanoseconds));
    }
    fn lock(self: *Capture) void {
        std.Io.Threaded.mutexLock(&self.mutex);
    }
    fn unlock(self: *Capture) void {
        std.Io.Threaded.mutexUnlock(&self.mutex);
    }
    fn id(self: *Capture) u64 {
        const result = self.next_id;
        self.next_id += 1;
        return result;
    }
    fn connection(self: *Capture, handle: t.Handle) ?*ConnectionState {
        if (handle.index >= self.connections.len) return null;
        const state = &self.connections[handle.index];
        return if (state.event != null and std.meta.eql(state.handle, handle)) state else null;
    }
    fn stream(self: *Capture, handle: t.StreamHandle) ?*StreamState {
        if (self.connection(handle.conn) == null) return null;
        const state = &self.streams[@as(usize, handle.conn.index) * limits.streams_per_connection + handle.slot];
        return if (state.event != null and std.meta.eql(state.handle, handle)) state else null;
    }
    fn lose(self: *Capture) void {
        self.dropped_bytes +|= self.byte_len;
        self.gap = true;
        self.head = 0;
        self.len = 0;
        self.byte_head = 0;
        self.byte_len = 0;
        self.ready.set(self.io);
    }
    fn append(self: *Capture, event: *const Event) void {
        if (self.gap) return;
        if (self.len == self.events.len) return self.lose();
        self.events[(self.head + self.len) % self.events.len] = event.*;
        self.len += 1;
        self.ready.set(self.io);
    }

    pub fn connected(self: *Capture, handle: t.Handle, peer: *const PeerId, remote: t.Address, local: t.Address, direction: t.Direction) void {
        self.lock();
        defer self.unlock();
        const state = &self.connections[handle.index];
        std.debug.assert(state.event == null);
        const alias = self.id();
        var peer_alias = alias;
        for (self.connections) |other| if (other.event) |event| {
            if (std.mem.eql(u8, &event.payload.connection.peer.bytes, &peer.bytes)) {
                peer_alias = event.payload.connection.peer_alias;
                break;
            }
        };
        state.* = .{ .handle = handle, .event = .{ .observed_at_ns = self.timestamp(), .payload = .{ .connection = .{ .id = alias, .peer_alias = peer_alias, .peer = peer.*, .remote = remote, .local = local, .direction = direction } } } };
        self.append(&state.event.?);
    }

    pub fn pathChanged(self: *Capture, handle: t.Handle, remote: t.Address, local: t.Address) void {
        self.lock();
        defer self.unlock();
        const state = self.connection(handle) orelse return;
        state.event.?.payload.connection.remote = remote;
        state.event.?.payload.connection.local = local;
        self.append(&state.event.?);
    }

    pub fn selected(self: *Capture, handle: t.StreamHandle, protocol: Protocol, direction: t.Direction, leftover: []const u8) void {
        self.lock();
        defer self.unlock();
        const conn = self.connection(handle.conn) orelse return;
        const state = &self.streams[@as(usize, handle.conn.index) * limits.streams_per_connection + handle.slot];
        std.debug.assert(state.event == null);
        state.* = .{ .handle = handle, .event = .{ .observed_at_ns = self.timestamp(), .payload = .{ .stream = .{ .id = self.id(), .connection = conn.event.?.payload.connection.id, .protocol = protocol, .direction = direction } } } };
        self.append(&state.event.?);
        self.dataLocked(state.event.?.payload.stream.id, .inbound, leftover);
    }

    pub fn data(self: *Capture, handle: t.StreamHandle, direction: t.Direction, bytes: []const u8) void {
        if (bytes.len == 0) return;
        self.lock();
        defer self.unlock();
        const state = self.stream(handle) orelse return;
        self.dataLocked(state.event.?.payload.stream.id, direction, bytes);
    }

    fn dataLocked(self: *Capture, alias: u64, direction: t.Direction, bytes: []const u8) void {
        if (bytes.len == 0) return;
        const chunks = std.math.divCeil(usize, bytes.len, chunk_max) catch unreachable;
        if (self.gap or bytes.len > self.bytes.len - self.byte_len or chunks > self.events.len - self.len) {
            self.lose();
            self.dropped_bytes +|= bytes.len;
            return;
        }
        const observed = self.timestamp();
        var offset: usize = 0;
        while (offset < bytes.len) {
            const length = @min(chunk_max, bytes.len - offset);
            const start = (self.byte_head + self.byte_len) % self.bytes.len;
            const first = @min(length, self.bytes.len - start);
            @memcpy(self.bytes[start..][0..first], bytes[offset..][0..first]);
            @memcpy(self.bytes[0 .. length - first], bytes[offset + first ..][0 .. length - first]);
            self.byte_len += length;
            self.append(&.{ .observed_at_ns = observed, .payload = .{ .data = .{ .stream = alias, .direction = direction, .offset = start, .length = length } } });
            offset += length;
        }
    }

    pub fn streamClosed(self: *Capture, handle: t.StreamHandle, reset: bool) void {
        self.lock();
        defer self.unlock();
        const state = self.stream(handle) orelse return;
        self.append(&.{ .observed_at_ns = self.timestamp(), .payload = .{ .stream_closed = .{ .stream = state.event.?.payload.stream.id, .reset = reset } } });
        state.event = null;
    }

    pub fn disconnected(self: *Capture, handle: t.Handle) void {
        self.lock();
        defer self.unlock();
        const state = self.connection(handle) orelse return;
        const start = @as(usize, handle.index) * limits.streams_per_connection;
        for (self.streams[start..][0..limits.streams_per_connection]) |live| if (live.event) |event| {
            self.append(&.{ .observed_at_ns = self.timestamp(), .payload = .{ .stream_closed = .{ .stream = event.payload.stream.id, .reset = true } } });
        };
        self.append(&.{ .observed_at_ns = self.timestamp(), .payload = .{ .connection_closed = state.event.?.payload.connection.id } });
        @memset(self.streams[start..][0..limits.streams_per_connection], .{});
        state.event = null;
    }

    /// Single consumer only. Returned copies remain valid until its next drain. Encoding and
    /// collector I/O run outside the mutex. Invalidate before discarding an undelivered batch.
    pub fn drain(self: *Capture) Batch {
        self.lock();
        defer self.unlock();
        const reset = self.gap;
        var count: usize = 0;
        var bytes: usize = 0;
        if (reset) {
            for (self.connections) |state| if (state.event) |event| {
                self.output_events[count] = event;
                count += 1;
            };
            for (self.streams) |state| if (state.event) |event| {
                self.output_events[count] = event;
                count += 1;
            };
            self.gap = false;
        } else {
            while (count < drain_events_max and self.len > 0) {
                var event = self.events[self.head];
                if (event.payload == .data) {
                    const data_event = &event.payload.data;
                    if (data_event.length > self.output_bytes.len - bytes) break;
                    std.debug.assert(data_event.offset == self.byte_head);
                    const first = @min(data_event.length, self.bytes.len - self.byte_head);
                    @memcpy(self.output_bytes[bytes..][0..first], self.bytes[self.byte_head..][0..first]);
                    @memcpy(self.output_bytes[bytes + first ..][0 .. data_event.length - first], self.bytes[0 .. data_event.length - first]);
                    self.byte_head = (self.byte_head + data_event.length) % self.bytes.len;
                    self.byte_len -= data_event.length;
                    data_event.offset = bytes;
                    bytes += data_event.length;
                }
                self.output_events[count] = event;
                count += 1;
                self.head = (self.head + 1) % self.events.len;
                self.len -= 1;
            }
        }
        if (self.len == 0) self.ready.reset();
        return .{ .events = self.output_events[0..count], .data = self.output_bytes[0..bytes], .reset = reset, .pending = self.len > 0, .buffered_bytes = self.byte_len, .dropped_bytes = self.dropped_bytes };
    }

    pub fn invalidate(self: *Capture, undelivered_bytes: usize) void {
        self.lock();
        defer self.unlock();
        self.lose();
        self.dropped_bytes +|= undelivered_bytes;
    }

    pub fn stats(self: *Capture) struct { buffered_bytes: usize, dropped_bytes: u64 } {
        self.lock();
        defer self.unlock();
        return .{ .buffered_bytes = self.byte_len, .dropped_bytes = self.dropped_bytes };
    }
};

test {
    _ = @import("stream_trace_test.zig");
}
