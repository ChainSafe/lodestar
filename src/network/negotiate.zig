const std = @import("std");
const time = @import("time.zig");
const Engine = @import("quic/Engine.zig");
const index_list = @import("index_list.zig");
const multistream = @import("wire/multistream.zig");
const stream_io = @import("stream_io.zig");
const types = @import("types.zig");
const DeadlineHeap = @import("deadline_heap.zig").DeadlineHeap;
const limits = @import("quic/limits.zig");

const assert = std.debug.assert;
const Handle = Engine.Handle;
const StreamHandle = Engine.StreamHandle;
const StreamError = Engine.StreamError;

pub const Negotiator = struct {
    release_revision: u64 = 0,
    allocator: std.mem.Allocator,
    entries: []Entry,
    outbound_control_reserved: u16 = 0,
    outbound_reserved: u16,
    inbound_per_connection_max: u16,
    shared_capacity: u16,
    /// Negotiating entries that can progress now: new, handed a stream event, or cut short.
    ready: index_list.List = .{},
    /// Outcomes waiting for output capacity, in completion order.
    pending: index_list.List = .{},
    /// Delivered outcomes whose leftover bytes stay borrowed until `releaseReported`.
    reported: index_list.List = .{},
    /// Negotiating entries keyed on started_ms + timeout_ms.
    timeouts: DeadlineHeap,
    /// Entries serviced by pump. An idle negotiator visits none.
    visits: u64 = 0,

    pub const negotiations_max_default: u16 = 256;
    pub const negotiations_max_ceiling: u16 = 4_096;
    pub const negotiate_timeout_ms: u64 = 10_000;
    pub const supported_max = multistream.supported_max;
    pub const Protocol = multistream.Protocol;
    pub const inbox_capacity: usize = 2 * multistream.message_length_max;
    pub const outbox_capacity: usize = multistream.listener_write_max;

    pub const Error = error{ NegotiationTableFull, InvalidLimits } || multistream.Error ||
        StreamError || std.mem.Allocator.Error;

    pub const Failure = enum { timeout, malformed, stream_closed, transport, overflow, exhausted };

    /// The selection echo is queued in QUIC; resetting the write side can still discard it.
    pub const Ready = struct {
        leftover: []const u8,
        fin: bool,
    };

    pub const Outcome = struct {
        stream: StreamHandle,
        direction: types.Direction = .inbound,
        protocol_index: ?u8 = null,
        result: Result,

        pub const Result = union(enum) {
            ready: Ready,
            rejected,
            failed: Failure,
        };
    };

    const State = enum { free, negotiating, pending, reported };
    const candidates_max = multistream.proposals_max;

    const Role = union(enum) {
        dialer: multistream.Dialer,
        listener: multistream.Listener,
    };

    const Entry = struct {
        state: State = .free,
        control: bool = false,
        stream: StreamHandle = undefined,
        started_ms: u64 = 0,
        timeout_ms: u64 = negotiate_timeout_ms,
        role: Role = undefined,
        selected: ?u8 = null,
        candidates: [candidates_max]Protocol = undefined,
        candidates_len: u8 = 0,
        candidate: u8 = 0,
        pending_result: Outcome.Result = undefined,
        fin_seen: bool = false,
        finishing_selected: bool = false,
        outbox: stream_io.Outbox = .{},
        out_buffer: [outbox_capacity]u8 = undefined,
        inbox: stream_io.Inbox(inbox_capacity) = .{},
        /// On `ready` while negotiating and able to progress without a new stream event.
        ready_link: index_list.Link = .{},
        /// On `pending` or `reported`, matching the state.
        outcome_link: index_list.Link = .{},
    };

    pub const Options = struct {
        negotiations_max: u16 = negotiations_max_default,
        outbound_control_reserved: u16 = 0,
        outbound_reserved: ?u16 = null,
        inbound_per_connection_max: u16 = 16,
        inbound_connections: u16 = 0,
    };

    pub fn validateOptions(options: Options) Error!void {
        const negotiations_max = options.negotiations_max;
        if (options.outbound_control_reserved > negotiations_max) return error.InvalidLimits;
        if (options.inbound_per_connection_max == 0 or options.inbound_per_connection_max > limits.peer_streams_bidi or
            options.inbound_connections > limits.connections_max_ceiling) return error.InvalidLimits;
        if (options.outbound_reserved) |reserved| {
            if (reserved > negotiations_max or reserved < options.outbound_control_reserved) return error.InvalidLimits;
        }
        if (negotiations_max == 0 or negotiations_max > negotiations_max_ceiling) {
            return error.InvalidLimits;
        }
    }

    pub fn init(allocator: std.mem.Allocator, options: Options) Error!Negotiator {
        try validateOptions(options);
        const negotiations_max = options.negotiations_max;
        const entries = try allocator.alloc(Entry, @as(usize, negotiations_max) + @as(usize, options.inbound_connections) * options.inbound_per_connection_max);
        errdefer allocator.free(entries);
        @memset(entries, .{});
        const timeouts = try DeadlineHeap.init(allocator, @intCast(entries.len));
        return .{
            .allocator = allocator,
            .entries = entries,
            .timeouts = timeouts,
            .shared_capacity = negotiations_max,
            .outbound_control_reserved = options.outbound_control_reserved,
            .outbound_reserved = options.outbound_reserved orelse @min(negotiations_max, options.outbound_control_reserved + negotiations_max / 4),
            .inbound_per_connection_max = options.inbound_per_connection_max,
        };
    }

    pub fn deinit(self: *Negotiator) void {
        self.timeouts.deinit(self.allocator);
        self.allocator.free(self.entries);
        self.* = undefined;
    }

    pub fn active(self: *const Negotiator) usize {
        var count: usize = 0;
        for (self.entries) |*entry| {
            if (entry.state == .negotiating) count += 1;
        }
        assert(count <= self.entries.len);
        return count;
    }

    /// Copies the bounded offer list; protocol strings must outlive negotiation.
    pub fn beginOutbound(
        self: *Negotiator,
        engine: *Engine,
        conn: Handle,
        protocols: []const Protocol,
        now: types.Now,
        options: struct { control: bool = false, timeout_ms: u64 = negotiate_timeout_ms },
    ) Error!StreamHandle {
        const timeout_ms = options.timeout_ms;
        const control = options.control;
        if (timeout_ms == 0) return error.InvalidLimits;
        if (protocols.len == 0 or protocols.len > candidates_max) return error.InvalidLimits;
        for (protocols) |protocol| _ = try multistream.Dialer.init(protocol.id);
        const index = self.claim(control) orelse return error.NegotiationTableFull;
        const entry = &self.entries[index];
        assert(entry.state == .free);
        const dialer = try multistream.Dialer.init(protocols[0].id);
        @memcpy(entry.candidates[0..protocols.len], protocols);
        entry.candidates_len = @intCast(protocols.len);
        entry.candidate = 0;
        const hello = try dialer.initialWrite(&entry.out_buffer);
        const stream = try engine.openStream(conn);
        engine.bindStream(stream, routeOf(index)) catch unreachable;
        entry.control = control;
        entry.stream = stream;
        entry.started_ms = now.millis();
        entry.timeout_ms = timeout_ms;
        entry.role = .{ .dialer = dialer };
        entry.selected = null;
        entry.fin_seen = false;
        entry.finishing_selected = false;
        entry.inbox = .{};
        entry.outbox = .{};
        entry.outbox.queue(hello, false);
        self.begin(index);
        assert(entry.outbox.bytes.len == hello.len);
        return stream;
    }

    pub fn acceptInbound(
        self: *Negotiator,
        engine: *Engine,
        stream: StreamHandle,
        now: types.Now,
    ) Error!void {
        if (self.entries.len > self.shared_capacity) {
            const first = @as(usize, self.shared_capacity) + @as(usize, stream.conn.index) * self.inbound_per_connection_max;
            if (first >= self.entries.len) return error.InvalidLimits;
            for (first..first + self.inbound_per_connection_max) |index| {
                if (self.entries[index].state != .free) continue;
                self.initInbound(engine, index, stream, now);
                return;
            }
            return error.NegotiationTableFull;
        }
        var inbound: usize = 0;
        var connection_inbound: usize = 0;
        for (self.entries) |*entry| {
            if (entry.state == .free or entry.role != .listener) continue;
            inbound += 1;
            if (std.meta.eql(entry.stream.conn, stream.conn)) connection_inbound += 1;
        }
        if (inbound >= self.entries.len - self.outbound_reserved or connection_inbound >= self.inbound_per_connection_max)
            return error.NegotiationTableFull;
        const index = self.claim(false) orelse return error.NegotiationTableFull;
        self.initInbound(engine, index, stream, now);
    }

    fn initInbound(self: *Negotiator, engine: *Engine, index: usize, stream: StreamHandle, now: types.Now) void {
        const entry = &self.entries[index];
        assert(entry.state == .free);
        // A stale handle has no events to route; its entry fails on the first read.
        engine.bindStream(stream, routeOf(index)) catch {};
        entry.stream = stream;
        entry.started_ms = now.millis();
        entry.timeout_ms = negotiate_timeout_ms;
        entry.control = false;
        entry.role = .{ .listener = .{} };
        entry.selected = null;
        entry.fin_seen = false;
        entry.finishing_selected = false;
        entry.inbox = .{};
        entry.outbox = .{};
        self.begin(index);
    }

    fn begin(self: *Negotiator, index: usize) void {
        const entry = &self.entries[index];
        assert(!entry.ready_link.linked and !entry.outcome_link.linked);
        entry.state = .negotiating;
        self.timeouts.set(@intCast(index), entry.started_ms +| entry.timeout_ms);
        self.markReady(index);
    }

    fn markReady(self: *Negotiator, index: usize) void {
        assert(self.entries[index].state == .negotiating);
        _ = self.ready.insert(self.entries, "ready_link", @intCast(index));
    }

    /// Records an outcome for delivery. A pending outcome may be replaced by a later failure.
    fn settle(self: *Negotiator, index: usize, result: Outcome.Result) void {
        const entry = &self.entries[index];
        assert(entry.state == .negotiating or entry.state == .pending);
        if (entry.ready_link.linked) self.ready.remove(self.entries, "ready_link", @intCast(index));
        self.timeouts.clear(@intCast(index));
        entry.pending_result = result;
        if (entry.state == .negotiating) self.pending.append(self.entries, "outcome_link", @intCast(index));
        entry.state = .pending;
    }

    fn release(self: *Negotiator, index: usize) void {
        const entry = &self.entries[index];
        if (entry.state != .free) self.release_revision += 1;
        if (entry.ready_link.linked) self.ready.remove(self.entries, "ready_link", @intCast(index));
        switch (entry.state) {
            .pending => self.pending.remove(self.entries, "outcome_link", @intCast(index)),
            .reported => self.reported.remove(self.entries, "outcome_link", @intCast(index)),
            .negotiating, .free => {},
        }
        self.timeouts.clear(@intCast(index));
        entry.state = .free;
    }

    /// A routed stream event for the entry at `row`. An event for a stream the entry no longer
    /// holds is dropped.
    pub fn streamReady(self: *Negotiator, row: u24, stream: StreamHandle) void {
        if (row >= self.entries.len) return;
        const entry = &self.entries[row];
        if (entry.state != .negotiating or !std.meta.eql(entry.stream, stream)) return;
        self.markReady(row);
    }

    /// Output pressure alone is ready only when the host supplies outcome capacity. O(1).
    pub fn schedule(self: *const Negotiator, outcome_capacity: usize) types.Schedule {
        return .{
            .runnable = self.ready.len > 0 or self.reported.len > 0 or
                (self.pending.len > 0 and outcome_capacity > 0),
            .deadline = time.optionalMilliseconds(if (self.timeouts.peek()) |top| top.deadline else null),
        };
    }

    /// Retains a selected listener's existing row until a bounded final response and FIN are queued.
    /// Call before releasing the outcome borrow; `bytes` are copied and may be stack-owned.
    pub fn finishSelected(self: *Negotiator, engine: *Engine, stream: StreamHandle, bytes: []const u8, now: types.Now) bool {
        if (bytes.len > outbox_capacity) return false;
        var row = self.reported.head;
        while (row != index_list.none) : (row = self.entries[row].outcome_link.next) {
            const entry = &self.entries[row];
            if (!std.meta.eql(entry.stream, stream)) continue;
            if (entry.role != .listener or entry.pending_result != .ready) return false;
            engine.bindStream(stream, routeOf(row)) catch return false;
            self.reported.remove(self.entries, "outcome_link", row);
            @memcpy(entry.out_buffer[0..bytes.len], bytes);
            entry.outbox.queue(entry.out_buffer[0..bytes.len], true);
            entry.finishing_selected = true;
            entry.started_ms = now.millis();
            self.begin(row);
            return true;
        }
        return false;
    }

    /// Ends the leftover borrows of every delivered outcome, freeing their entries.
    pub fn releaseReported(self: *Negotiator) void {
        var released: usize = 0;
        while (self.reported.pop(self.entries, "outcome_link")) |row| : (released += 1) {
            assert(released < self.entries.len);
            assert(self.entries[row].state == .reported);
            self.entries[row].state = .free;
        }
    }

    pub fn pump(
        self: *Negotiator,
        engine: *Engine,
        now: types.Now,
        supported: []const Protocol,
        outcomes: []Outcome,
    ) usize {
        assert(supported.len <= supported_max);
        self.releaseReported();
        // An expired entry fails on its next advance.
        var expired: usize = 0;
        while (self.timeouts.popDue(now.millis())) |row| : (expired += 1) {
            assert(expired < self.entries.len);
            self.markReady(row);
        }
        // Entries re-marked while serviced wait for the next pump.
        const serviced = self.ready.len;
        for (0..serviced) |_| {
            const index = self.ready.pop(self.entries, "ready_link").?;
            self.visits +|= 1;
            if (self.advance(engine, index, now, supported)) |outcome| self.settle(index, outcome.result);
        }
        var count: usize = 0;
        while (count < outcomes.len) : (count += 1) {
            const index = self.pending.pop(self.entries, "outcome_link") orelse break;
            const entry = &self.entries[index];
            assert(entry.state == .pending);
            outcomes[count] = .{
                .stream = entry.stream,
                .direction = direction(entry),
                .protocol_index = switch (entry.role) {
                    .dialer => entry.candidates[entry.candidate].index,
                    .listener => entry.selected,
                },
                .result = entry.pending_result,
            };
            entry.state = .reported;
            self.reported.append(self.entries, "outcome_link", index);
        }
        assert(count <= outcomes.len);
        if (@import("builtin").is_test) self.checkInvariants(engine, now);
        return count;
    }

    pub fn connectionClosed(self: *Negotiator, engine: *Engine, conn: Handle) void {
        for (self.entries, 0..) |*entry, index| {
            if (entry.state != .negotiating and entry.state != .pending) continue;
            if (!std.meta.eql(entry.stream.conn, conn)) continue;
            if (entry.finishing_selected) {
                engine.closeStream(entry.stream, types.app_error_negotiation_failed);
                self.release(index);
            } else self.settle(index, fail(engine, entry, .stream_closed).result);
        }
    }

    pub fn cancel(self: *Negotiator, engine: *Engine, stream: StreamHandle) void {
        const bound = engine.route(stream);
        if (bound != null and bound.?.owner == .negotiation) {
            const row = bound.?.row;
            if (row < self.entries.len and self.entries[row].state != .free and std.meta.eql(self.entries[row].stream, stream)) self.release(row);
        } else for (self.entries, 0..) |*entry, index| {
            if (entry.state == .free or !std.meta.eql(entry.stream, stream)) continue;
            self.release(index);
        }
        engine.closeStream(stream, types.app_error_negotiation_failed);
    }

    /// Cancels current negotiations and ends outcome borrows. Future admission remains enabled.
    pub fn cancelAll(self: *Negotiator, engine: *Engine) void {
        for (self.entries, 0..) |*entry, index| {
            if (entry.state == .free) continue;
            engine.closeStream(entry.stream, types.app_error_negotiation_failed);
            self.release(index);
        }
    }

    fn claim(self: *Negotiator, control: bool) ?usize {
        if (!control and self.outbound_control_reserved > 0) {
            var ordinary: usize = 0;
            for (self.entries[0..self.shared_capacity]) |*entry| {
                if (entry.state != .free and !entry.control) ordinary += 1;
            }
            if (ordinary >= self.shared_capacity - self.outbound_control_reserved) return null;
        }
        for (self.entries[0..self.shared_capacity], 0..) |*entry, index| {
            if (entry.state == .free) return index;
        }
        return null;
    }

    /// Returns an outcome when negotiation ended. An entry that can progress without a new
    /// stream event goes back on `ready`.
    fn advance(self: *Negotiator, engine: *Engine, index: usize, now: types.Now, supported: []const Protocol) ?Outcome {
        const entry = &self.entries[index];
        assert(entry.state == .negotiating);
        if (entry.finishing_selected) {
            self.finishSelectedWrite(engine, index, now);
            return null;
        }
        const waited_ms = now.millis() -| entry.started_ms;
        if (waited_ms >= entry.timeout_ms) return fail(engine, entry, .timeout);
        const flushed = entry.outbox.pump(engine, entry.stream) catch |err|
            return failStream(engine, entry, err);
        if (flushed != .done) {
            if (flushed == .yielded) self.markReady(index);
            return null;
        }
        if (entry.selected != null) return readyOutcome(entry);
        if (entry.inbox.free() == 0) return fail(engine, entry, .overflow);
        const read = entry.inbox.fill(engine, entry.stream) catch |err|
            return failStream(engine, entry, err);
        if (entry.inbox.len == 0 and !read.fin) return null;
        if (read.fin) entry.fin_seen = true;
        var again = read.len > 0;
        switch (entry.role) {
            .dialer => |*dialer| {
                const outcome = dialer.feed(entry.inbox.slice()) catch
                    return fail(engine, entry, .malformed);
                entry.inbox.drop(outcome.consumed);
                switch (outcome.status) {
                    .accepted => return readyOutcome(entry),
                    .rejected => {
                        if (!entry.fin_seen and entry.candidate + 1 < entry.candidates_len) {
                            if (proposeNext(engine, entry, dialer)) |failed| return failed;
                            self.markReady(index);
                            return null;
                        }
                        engine.closeStream(entry.stream, types.app_error_negotiation_failed);
                        return .{ .stream = entry.stream, .result = .rejected };
                    },
                    .pending => {},
                }
            },
            .listener => |*listener| {
                const outcome = listener.feed(entry.inbox.slice(), supported, &entry.out_buffer) catch
                    return fail(engine, entry, .malformed);
                entry.inbox.drop(outcome.consumed);
                if (outcome.write.len > 0) {
                    entry.outbox.queue(outcome.write, false);
                    again = true;
                }
                switch (outcome.status) {
                    .selected => |selected| {
                        entry.selected = selected;
                        const replied = entry.outbox.pump(engine, entry.stream) catch |err|
                            return failStream(engine, entry, err);
                        if (replied == .yielded) self.markReady(index);
                        return if (replied == .done) readyOutcome(entry) else null;
                    },
                    .failed => return fail(engine, entry, .exhausted),
                    .pending => {},
                }
            },
        }
        if (read.fin) return fail(engine, entry, .stream_closed);
        if (again) self.markReady(index);
        return null;
    }

    fn finishSelectedWrite(self: *Negotiator, engine: *Engine, index: usize, now: types.Now) void {
        const entry = &self.entries[index];
        if (now.millis() -| entry.started_ms >= entry.timeout_ms) {
            engine.closeStream(entry.stream, types.app_error_negotiation_failed);
            self.release(index);
            return;
        }
        const progress = entry.outbox.pump(engine, entry.stream) catch {
            engine.closeStream(entry.stream, types.app_error_negotiation_failed);
            self.release(index);
            return;
        };
        switch (progress) {
            .blocked => {},
            .yielded => self.markReady(index),
            .done => {
                engine.shutdown(entry.stream, .read, 0);
                self.release(index);
            },
        }
    }

    /// Test builds check, after every pump, that the lists and the heap match the entry states,
    /// that no entry with work is off `ready`, and that each live stream routes to its entry.
    fn checkInvariants(self: *const Negotiator, engine: *const Engine, now: types.Now) void {
        var marked: usize = 0;
        var outcomes: usize = 0;
        for (self.entries, 0..) |*entry, index| {
            marked += @intFromBool(entry.ready_link.linked);
            outcomes += @intFromBool(entry.outcome_link.linked);
            assert(!entry.ready_link.linked or entry.state == .negotiating);
            assert(entry.outcome_link.linked == (entry.state == .pending or entry.state == .reported));
            const key = self.timeouts.get(@intCast(index));
            if (entry.state != .negotiating) {
                assert(key == null);
                continue;
            }
            assert(key.? == entry.started_ms +| entry.timeout_ms);
            // An expired entry is serviced by the pump that sees its key due.
            assert(key.? > now.millis() or entry.ready_link.linked);
            const bound = engine.route(entry.stream) orelse continue;
            assert(bound.owner == .negotiation and bound.row == index);
            if (entry.ready_link.linked) continue;
            const stream = engine.streamWaits(entry.stream) orelse continue;
            if (!entry.outbox.idle()) {
                assert(stream.write_waiting);
            } else if (entry.selected == null) assert(!stream.read_open);
        }
        assert(marked == self.ready.len);
        assert(outcomes == self.pending.len + self.reported.len);
    }

    fn routeOf(index: usize) types.Route {
        return .{ .owner = .negotiation, .row = @intCast(index) };
    }

    /// Returns a failure when the next proposal cannot be encoded.
    fn proposeNext(engine: *Engine, entry: *Entry, dialer: *multistream.Dialer) ?Outcome {
        assert(entry.candidate + 1 < entry.candidates_len);
        entry.candidate += 1;
        dialer.* = .{
            .protocol = entry.candidates[entry.candidate].id,
            .header_seen = true,
        };
        const proposal = multistream.encodeMessage(dialer.protocol, &entry.out_buffer) catch
            return fail(engine, entry, .transport);
        entry.outbox.queue(proposal, false);
        return null;
    }

    fn direction(entry: *const Entry) types.Direction {
        return switch (entry.role) {
            .dialer => .outbound,
            .listener => .inbound,
        };
    }

    fn readyOutcome(entry: *const Entry) Outcome {
        assert(entry.outbox.idle());
        return .{ .stream = entry.stream, .result = .{ .ready = .{
            .leftover = entry.inbox.slice(),
            .fin = entry.fin_seen,
        } } };
    }

    fn fail(engine: *Engine, entry: *const Entry, failure: Failure) Outcome {
        engine.closeStream(entry.stream, types.app_error_negotiation_failed);
        return .{ .stream = entry.stream, .result = .{ .failed = failure } };
    }

    fn failStream(engine: *Engine, entry: *const Entry, err: StreamError) Outcome {
        const failure: Failure = switch (err) {
            error.StaleHandle, error.UnknownStream, error.StreamStopped => .stream_closed,
            else => .transport,
        };
        return fail(engine, entry, failure);
    }

    comptime {
        assert(@sizeOf(Entry) <= 1_536);
        assert(supported_max < std.math.maxInt(u8));
        assert(negotiations_max_default <= negotiations_max_ceiling);
        assert(2 * multistream.message_length_max <= outbox_capacity);
    }
};

test {
    _ = @import("negotiate_test.zig");
}
