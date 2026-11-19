const std = @import("std");
const builtin = @import("builtin");
const constants = @import("constants.zig");
const Engine = @import("quic/Engine.zig");
const keys = @import("wire/keys.zig");
const multiaddr = @import("wire/multiaddr.zig");
const peer_id = @import("wire/peer_id.zig");
const tls = @import("tls/context.zig");
const types = @import("types.zig");
const Sockets = @import("udp").Sockets;

const assert = std.debug.assert;

pub const Transport = struct {
    engine: Engine = undefined,
    sockets: Sockets = .{},
    counters: Counters = .{},
    send_drops: Sockets.SendDrops = .{},
    work_limits: WorkLimits = .{},
    batch: SendBatch = .{},
    batch_len: u8 = 0,
    receive_batch: ReceiveBatch = undefined,

    pub const Options = struct {
        host: *const keys.KeyPair,
        bind: Sockets.Bindings,
        limits: Engine.Limits = .{},
        work_limits: WorkLimits = .{},
        /// Null keeps the system's default socket buffer sizes.
        socket_buffers: ?Sockets.Buffers = null,
    };

    pub const InitError = tls.Error || Engine.Error || std.Io.net.IpAddress.BindError ||
        std.Io.RandomSecureError || error{ClockOutOfRange};

    pub const send_burst_max: u16 = 256;
    pub const receive_per_turn_max: u16 = 256;

    pub const WorkLimits = struct {
        /// Datagrams sent per turn.
        send_per_turn_max: u16 = send_burst_max,
        receive_per_turn_max: u16 = constants.receive_batch_max,
        /// Datagrams sent per dirty-connection visit.
        burst_per_connection: u16 = constants.send_batch_max,

        pub fn validate(self: WorkLimits) error{InvalidLimits}!void {
            if (self.send_per_turn_max == 0 or self.send_per_turn_max > send_burst_max) return error.InvalidLimits;
            if (self.receive_per_turn_max == 0 or self.receive_per_turn_max > Transport.receive_per_turn_max) return error.InvalidLimits;
            if (self.burst_per_connection == 0 or self.burst_per_connection > self.send_per_turn_max) return error.InvalidLimits;
        }
    };

    /// quiche writes each datagram straight into buffers. The socket sender may group adjacent
    /// datagrams for segmentation offload; owners and budgets always count individual datagrams.
    pub const SendBatch = struct {
        buffers: [constants.send_batch_max][constants.datagram_size_max]u8 = undefined,
        outgoing: [constants.send_batch_max]Sockets.Outgoing = undefined,
        release_times: [constants.send_batch_max]u64 = undefined,
        scratch: Sockets.BatchScratch = undefined,
        owners: [constants.send_batch_max]types.Handle = undefined,
    };

    pub const ReceiveBatch = struct {
        buffers: [Sockets.receive_batch_max][constants.datagram_size_max]u8,
        slots: [Sockets.receive_batch_max]Sockets.ReceiveSlot,
        scratch: Sockets.ReceiveScratch,
    };

    /// Configured QUIC windows and packet batches, excluding native overhead.
    pub const MemoryPlan = struct {
        engine: Engine.MemoryPlan,
        ready_batch_datagrams: u8 = constants.send_batch_max,
        ready_batch_storage_bytes: u64 = @sizeOf(SendBatch),
        receive_batch_storage_bytes: u64 = @sizeOf(ReceiveBatch),
    };

    pub const AdvanceError = Sockets.DatagramError;
    pub const DialError = Sockets.SendError || Engine.DialError || error{ DestinationUnreachable, MissingPeerId };

    pub const Progress = struct {
        now: Engine.Now,
        datagrams_received: u32 = 0,
        datagrams_accepted: u32 = 0,
        datagrams_dropped: u32 = 0,
        version_negotiations: u32 = 0,
        datagrams_sent: u32 = 0,
        send_calls: u32 = 0,
        receive_errors: u32 = 0,
        send_failures: u32 = 0,
        events: usize = 0,
        events_pending: bool = false,
        /// A flush stopped at a burst or turn budget, so connections still have output.
        backlog: bool = false,
    };

    pub const AdvanceResult = struct {
        progress: Progress,
        cancelled: bool = false,
        failure: ?AdvanceError = null,
    };

    pub const Counters = struct {
        received_bytes: u64 = 0,
        sent_bytes: u64 = 0,
        received_datagrams: u64 = 0,
        sent_datagrams: u64 = 0,
        receive_turns: u64 = 0,
        receive_budget_exhausted: u64 = 0,
    };

    /// The I/O provider must honor std.Io.randomSecure's external entropy contract.
    pub fn init(
        target: *Transport,
        allocator: std.mem.Allocator,
        io: std.Io,
        options: Options,
    ) InitError!void {
        try options.work_limits.validate();
        if (options.socket_buffers) |request| if (!request.valid()) return error.InvalidLimits;
        var serial: [8]u8 = undefined;
        try std.Io.randomSecure(io, &serial);
        var seed_bytes: [std.Random.DefaultCsprng.secret_seed_length]u8 = undefined;
        defer std.crypto.secureZero(u8, &seed_bytes);
        try std.Io.randomSecure(io, &seed_bytes);
        const now = try Engine.Now.read(io);
        var context = try tls.Context.init(options.host, now.unixSeconds(), serial);
        var context_owned = true;
        errdefer if (context_owned) context.deinit();
        target.sockets = try Sockets.bind(io, options.bind);
        errdefer target.sockets.close(io);
        if (options.socket_buffers) |request| target.sockets.requestBuffersLogged(request, .network_quic);
        target.engine = try Engine.init(allocator, .{
            .tls = context,
            .limits = options.limits,
            .local = target.sockets.localAddresses(),
            .seed = &seed_bytes,
        });
        context_owned = false;
        target.work_limits = options.work_limits;
        target.batch_len = 0;
        target.counters = .{};
        target.send_drops = .{};
        assert(target.engine.registry.slots.len == options.limits.connections_max);
    }

    pub fn deinit(self: *Transport, io: std.Io) void {
        self.engine.deinit();
        self.sockets.close(io);
        self.* = undefined;
    }

    pub fn peerId(self: *const Transport) peer_id.PeerId {
        assert(self.engine.registry.slots.len > 0);
        return self.engine.tls.local_peer_id;
    }

    pub fn localAddress(self: *const Transport) types.Address {
        assert(self.engine.registry.slots.len > 0);
        return self.sockets.localAddress();
    }

    pub fn localMultiaddr(self: *const Transport) multiaddr.Multiaddr {
        assert(self.engine.registry.slots.len > 0);
        return .{ .address = self.sockets.localAddress(), .peer = self.engine.tls.local_peer_id };
    }

    pub fn memoryPlan(self: *const Transport) MemoryPlan {
        return .{ .engine = self.engine.memoryPlan() };
    }

    pub fn dial(
        self: *Transport,
        io: std.Io,
        target: *const multiaddr.Multiaddr,
        now: Engine.Now,
    ) DialError!Engine.Handle {
        const expected = target.peer orelse return error.MissingPeerId;
        return self.dialPeer(io, target.address, expected, now);
    }

    /// Earliest engine timer key in monotonic nanoseconds. O(1).
    pub fn nextDeadlineNs(self: *const Transport) ?u64 {
        return self.engine.nextDeadlineNs();
    }

    /// Produces the first flight before returning. Local pressure drops it for QUIC loss recovery;
    /// other send failures are dial errors.
    pub fn dialPeer(
        self: *Transport,
        io: std.Io,
        peer: types.Address,
        expected: peer_id.PeerId,
        now: Engine.Now,
    ) DialError!Engine.Handle {
        const handle = self.engine.dial(&peer, expected, now) catch |err| switch (err) {
            error.AddressFamilyUnsupported => return error.DestinationUnreachable,
            else => return err,
        };
        assert(self.batch_len == 0);
        var result = Progress{ .now = now };
        var remaining: u32 = self.work_limits.send_per_turn_max;
        assert(remaining > 0);
        const drained = self.burst(io, handle.index, handle, now, &remaining, &result) catch |err| {
            self.engine.sent(handle.index, keyClock(io, now), false);
            _ = self.engine.abandon(handle);
            return err;
        };
        const failure = self.submit(io, &result);
        self.engine.sent(handle.index, keyClock(io, now), drained);
        if (failure) |err| {
            _ = self.engine.abandon(handle);
            return if (Sockets.destinationUnreachable(err)) error.DestinationUnreachable else err;
        }
        return handle;
    }

    /// Ends the preceding turn's transport-event borrow and retires reported connections.
    pub fn beginTurn(self: *Transport, now: Engine.Now) Progress {
        self.engine.releaseReported();
        return .{ .now = now };
    }

    pub const Input = struct {
        now: Engine.Now,
        ready: [2]bool = @splat(false),
        cancelled: bool = false,
    };

    /// Uses the same receive/process/flush ordering as NetworkCore. Events caused by
    /// flush remain pending for the next turn. Consume event borrows before advancing again.
    pub fn advance(self: *Transport, io: std.Io, input: Input, events: []Engine.Event) AdvanceResult {
        const now = input.now;
        var result = self.beginTurn(now);
        var cancelled = input.cancelled;
        var failure: ?AdvanceError = if (cancelled) error.Canceled else null;
        if (!cancelled) self.receive(io, &result, input.ready) catch |err| {
            cancelled = cancelled or err == error.Canceled;
            failure = failure orelse err;
        };
        result.events = self.process(now, events);
        result.events_pending = self.engine.eventsPending();
        if (!cancelled) self.flush(io, now, &result) catch |err| {
            cancelled = true;
            failure = failure orelse err;
        };
        return .{ .progress = result, .cancelled = cancelled, .failure = failure };
    }

    /// Non-blocking drain of the QUIC sockets into the engine, up to the receive budget. Reads
    /// only the families `ready` marks, indexed like the sockets, alternating bounded batches.
    /// A family found empty is not read again this turn; a later arrival keeps its
    /// socket readable for the owner's next poll.
    pub fn receive(self: *Transport, io: std.Io, result: *Progress, ready: [2]bool) AdvanceError!void {
        return self.receiveBatch(io, result, ready);
    }

    /// Advances the receive batch and due timers, then drains connection and stream events.
    pub fn process(self: *Transport, now: Engine.Now, events: []Engine.Event) usize {
        self.engine.advance(now);
        return self.engine.pollEvents(events);
    }

    /// Drains the dirty connections in bursts of burst_per_connection datagrams until each
    /// reports Done or the turn's send budget runs out. A connection its burst did not finish
    /// moves to the dirty tail, so busy connections share the budget round-robin. A failed
    /// datagram fails only its own connection; the rest of its batch is resubmitted. Temporary
    /// local pressure instead drops the unsent suffix for QUIC loss recovery.
    /// Cancellation stops production and submission, retains completed progress, and leaves
    /// connection recovery state intact. It never identifies a failed destination.
    pub fn flush(self: *Transport, io: std.Io, now: Engine.Now, result: *Progress) std.Io.Cancelable!void {
        assert(self.batch_len == 0);
        var remaining: u32 = self.work_limits.send_per_turn_max;
        assert(remaining > 0);
        // The latest clock read that keyed a timer.
        var keyed = now;
        defer {
            result.backlog = self.engine.backlog();
            self.engine.finishFlush(keyed);
        }
        // Each visit either drains its connection or sends at least one datagram.
        const visits_max = self.engine.dirtyCount() + remaining;
        for (0..visits_max) |_| {
            if (remaining == 0) break;
            const index = self.engine.nextDirty() orelse break;
            const owner = self.engine.sendOwner(index) orelse {
                self.engine.sent(index, keyed, true);
                continue;
            };
            const drained = self.burst(io, index, owner, now, &remaining, result) catch |err| {
                keyed = keyClock(io, keyed);
                self.engine.sent(index, keyed, false);
                return err;
            };
            keyed = keyClock(io, keyed);
            self.engine.sent(index, keyed, drained);
        }
        if (self.submit(io, result)) |err| if (err == error.Canceled) return error.Canceled;
    }

    /// quiche reports the time left on its timer from its own clock read, so a timer key built on
    /// a clock read earlier in the turn lands early by the time the turn has run since.
    /// Refresh the supplied timestamp after the burst, using the same I/O clock as the driver.
    fn keyClock(io: std.Io, after: Engine.Now) Engine.Now {
        const read = std.Io.Clock.Timestamp.now(io, .awake);
        if (read.raw.nanoseconds > std.math.maxInt(u64) or !read.compare(.gt, after.monotonic)) return after;
        return .{ .monotonic = read, .wall = after.wall };
    }

    /// Sends up to burst_per_connection datagrams of one connection into the shared batch.
    /// Returns whether quiche reported nothing left to send.
    fn burst(self: *Transport, io: std.Io, index: u16, owner: types.Handle, now: Engine.Now, remaining: *u32, result: *Progress) std.Io.Cancelable!bool {
        var count: u16 = 0;
        while (count < self.work_limits.burst_per_connection and remaining.* > 0) : (count += 1) {
            if (self.batch_len == constants.send_batch_max) {
                if (self.submit(io, result)) |err| if (err == error.Canceled) return error.Canceled;
            }
            const at = self.batch_len;
            const sent = self.engine.sendOne(index, now, &self.batch.buffers[at]) orelse return true;
            assert(sent.bytes.len <= constants.datagram_size_max);
            self.batch.outgoing[at] = .{ .to = sent.to, .bytes = sent.bytes };
            self.batch.release_times[at] = sent.transmit_at_ns;
            self.batch.owners[at] = owner;
            self.batch_len += 1;
            remaining.* -= 1;
        }
        return false;
    }

    /// QUIC already accounts for produced packets as sent. Local pressure and transient routing failures on
    /// authenticated connections drop bytes for loss recovery; unreachable handshakes fail immediately.
    fn submit(self: *Transport, io: std.Io, result: *Progress) ?Sockets.SendError {
        const count = self.batch_len;
        if (count == 0) return null;
        defer self.batch_len = 0;
        if (builtin.mode == .Debug) assertReleased(io, self.batch.release_times[0..count]);
        var first: ?Sockets.SendError = null;
        var begin: usize = 0;
        while (begin < count) {
            result.send_calls += 1;
            const outcome = self.sockets.sendMany(io, self.batch.outgoing[begin..count], constants.datagram_size_max, &self.batch.scratch);
            for (self.batch.outgoing[begin..][0..outcome.sent]) |sent| {
                self.counters.sent_bytes +|= sent.bytes.len;
                self.counters.sent_datagrams +|= 1;
            }
            assert(begin + outcome.sent <= count);
            result.datagrams_sent += @intCast(outcome.sent);
            begin += outcome.sent;
            const err = outcome.failure orelse break;
            if (Sockets.SendDrops.Reason.fromError(err)) |reason| {
                for (self.batch.outgoing[begin..count]) |unsent| self.send_drops.add(reason, unsent.bytes.len);
                break;
            }
            if (err == error.Canceled) return error.Canceled;
            const owner = self.batch.owners[begin];
            var end = begin + 1;
            while (end < count and std.meta.eql(self.batch.owners[end], owner)) : (end += 1) {}
            if (Sockets.destinationUnreachable(err) and self.engine.peerId(owner) != null) {
                for (self.batch.outgoing[begin..end]) |unsent| self.send_drops.add(.destination_unreachable, unsent.bytes.len);
            } else {
                first = first orelse err;
                if (self.engine.failSend(owner)) result.send_failures += 1;
            }
            begin = end;
        }
        return first;
    }

    pub fn schedule(self: *const Transport, event_capacity: usize) types.Schedule {
        const deadline = self.engine.nextDeadlineNs();
        return .{
            .runnable = self.engine.backlog() or (event_capacity > 0 and self.engine.eventsPending()) or self.engine.releasesPending(),
            .deadline = if (deadline) |ns| .{ .clock = .awake, .raw = .fromNanoseconds(ns) } else null,
        };
    }

    fn receiveBatch(self: *Transport, io: std.Io, result: *Progress, ready: [2]bool) AdvanceError!void {
        assert(self.batch_len == 0);
        var eligible = ready;
        var count: u32 = 0;
        defer {
            self.counters.receive_turns +|= 1;
            self.counters.receive_budget_exhausted +|= @intFromBool(count == self.work_limits.receive_per_turn_max);
        }
        while (count < self.work_limits.receive_per_turn_max) {
            const room = @min(Sockets.receive_batch_max, self.work_limits.receive_per_turn_max - count);
            const slots = self.receive_batch.slots[0..room];
            for (slots, self.receive_batch.buffers[0..room]) |*slot, *buffer|
                slot.* = .{ .buffer = buffer };
            const received = self.sockets.receiveManyReady(io, slots, &eligible, &self.receive_batch.scratch);
            for (slots[0..received.received]) |*slot| {
                count += 1;
                const datagram = slot.datagram() catch |err| {
                    try self.recordReceiveError(result, err);
                    continue;
                };
                self.counters.received_datagrams +|= 1;
                self.counters.received_bytes +|= datagram.bytes.len;
                try self.receivePacket(io, result, &datagram);
            }
            if (received.failure) |err| {
                count += 1;
                try self.recordReceiveError(result, err);
            } else if (received.received == 0) break;
        }
    }

    fn receivePacket(self: *Transport, io: std.Io, result: *Progress, datagram: *const Sockets.Datagram) AdvanceError!void {
        result.datagrams_received += 1;
        // Version negotiation and retry replies use the idle send batch buffer.
        const outcome = self.engine.receive(datagram.bytes, &datagram.from, result.now, &self.batch.buffers[0]);
        switch (outcome) {
            .accepted => result.datagrams_accepted += 1,
            .version_negotiation, .retry => |bytes| {
                self.sendReply(io, datagram.from, bytes) catch |err| {
                    if (err == error.Canceled) return error.Canceled;
                };
                if (outcome == .version_negotiation) result.version_negotiations += 1;
            },
            .dropped => result.datagrams_dropped += 1,
        }
    }

    fn recordReceiveError(self: *Transport, result: *Progress, err: AdvanceError) AdvanceError!void {
        switch (err) {
            error.DatagramTooLarge,
            error.InvalidSourceAddress,
            error.PortUnreachable,
            error.ConnectionResetByPeer,
            error.NetworkDown,
            error.SystemResources,
            => {
                if (err == error.DatagramTooLarge) self.counters.received_datagrams +|= 1;
                result.receive_errors += 1;
            },
            else => return err,
        }
    }

    fn sendReply(self: *Transport, io: std.Io, destination: types.Address, bytes: []const u8) Sockets.SendError!void {
        self.sockets.sendTo(io, destination, bytes, constants.datagram_size_max) catch |err| {
            if (Sockets.SendDrops.Reason.fromError(err)) |reason| self.send_drops.add(reason, bytes.len);
            return err;
        };
        self.counters.sent_bytes +|= bytes.len;
        self.counters.sent_datagrams +|= 1;
    }

    /// quiche 0.28 under CUBIC releases every datagram at its send time. A controller that paces
    /// would need held datagrams, which this transport does not keep.
    fn assertReleased(io: std.Io, release_times: []const u64) void {
        const now = Engine.Now.read(io) catch return;
        for (release_times) |release_time| assert(release_time <= now.nanos());
    }

    comptime {
        assert(@sizeOf(Transport) <= 64 * 1_024);
        assert(send_burst_max % constants.send_batch_max == 0);
    }
};

test {
    _ = @import("transport_io_test.zig");
    _ = @import("transport_test.zig");
}
