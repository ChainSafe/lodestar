const std = @import("std");
const builtin = @import("builtin");
const Promise = @import("network_promise.zig");
const network_runtime = @import("network_runtime.zig");
const network_owner = @import("network_owner.zig");

pub const capacity = 32;
pub const connect_max = 16;
pub const turn_max = 4;
pub const State = enum { free, preparing, queued, executing, waiting, terminal, copying };
pub const Token = struct { index: u8, generation: u64 };
pub const Cell = struct {
    state: State = .free,
    /// Only the JavaScript thread creates or settles this promise; the owner records its outcome.
    promise: Promise = .{},
    generation: u64 = 0,
    order: u64 = 0,
    input: Input = .getMetrics,
    failure: ?anyerror = null,
    boolean: bool = false,
    deadline: u64 = 0,
};
pub const Table = struct {
    cells: [capacity]Cell = @splat(.{}),
    /// The terminal cells awaiting Promise settlement. `transition` keeps it current.
    terminal: std.StaticBitSet(capacity) = .empty,
    /// Past the last delivered cell, where delivery resumes, so refilled low cells cannot starve higher ones.
    completion_cursor: usize = 0,
    diagnostic: ?u8 = null,
    connects: u8 = 0,
    occupied: u8 = 0,
    admission_sequence: u64 = 0,
    release_revision: u64 = 0,

    pub fn nextOrder(self: *Table) !u64 {
        if (self.admission_sequence >= std.math.maxInt(u64) - 1) return error.NetworkSequenceExhausted;
        self.admission_sequence += 1;
        return self.admission_sequence;
    }
    pub fn reserve(self: *Table, command: Command) !Token {
        if (command == .connect and self.connects == connect_max) return error.NetworkCommandFull;
        // A single producer of local state can always submit despite unrelated command pressure.
        const start: usize = if (command == .applyIntent or command == .updateStatus) 0 else 1;
        for (self.cells[start..], start..) |*cell, i| {
            if (cell.state != .free) continue;
            const generation = std.math.add(u64, cell.generation, 1) catch return error.NetworkSequenceExhausted;
            const order = try self.nextOrder();
            cell.* = .{ .state = .preparing, .generation = generation, .order = order, .input = switch (command) {
                inline else => |tag| @unionInit(Input, @tagName(tag), undefined),
            } };
            self.connects += @intFromBool(command == .connect);
            self.occupied += 1;
            return .{ .index = @intCast(i), .generation = generation };
        }
        return error.NetworkCommandFull;
    }
    pub fn nextQueued(self: *Table) ?Token {
        var selected: ?Token = null;
        var order: u64 = std.math.maxInt(u64);
        for (&self.cells, 0..) |*cell, i| {
            if (isDiagnostic(cell.input) and self.diagnostic != null) continue;
            if (cell.state == .queued and (selected == null or cell.order < order)) {
                selected = .{ .index = @intCast(i), .generation = cell.generation };
                order = cell.order;
            }
        }
        return selected;
    }
    pub fn get(self: *Table, token: Token) *Cell {
        const cell = &self.cells[token.index];
        std.debug.assert(cell.generation == token.generation and cell.state != .free);
        return cell;
    }
    pub fn retire(self: *Table, token: Token) void {
        const cell = self.get(token);
        if (self.diagnostic == token.index) self.diagnostic = null;
        self.connects -= @intFromBool(cell.input == .connect);
        self.occupied -= 1;
        self.release_revision = std.math.add(u64, self.release_revision, 1) catch unreachable;
        self.transition(cell, .free);
        cell.promise.deinit();
    }
    /// Moves `cell` to `state`, keeping the terminal set current.
    pub fn transition(self: *Table, cell: *Cell, state: State) void {
        const index = (@intFromPtr(cell) - @intFromPtr(&self.cells)) / @sizeOf(Cell);
        std.debug.assert(&self.cells[index] == cell);
        if (state == .executing and isDiagnostic(cell.input)) {
            std.debug.assert(self.diagnostic == null);
            self.diagnostic = @intCast(index);
        }
        cell.state = state;
        self.terminal.setValue(index, state == .terminal);
    }
    /// The first terminal cell at or after `from`. O(1).
    pub fn nextTerminal(self: *const Table, from: usize) ?usize {
        var rest = self.terminal;
        rest.setRangeValue(.{ .start = 0, .end = @min(from, capacity) }, false);
        return rest.findFirstSet();
    }
    /// Whether any completion awaits delivery. O(1); debug builds check it against a scan.
    pub fn anyTerminal(self: *const Table) bool {
        if (builtin.mode == .Debug) for (&self.cells, 0..) |*cell, i| std.debug.assert(self.terminal.isSet(i) == (cell.state == .terminal));
        return self.terminal.findFirstSet() != null;
    }
};

const n = @import("network");
pub const Command = std.meta.Tag(Input);
fn isDiagnostic(command: Command) bool {
    return command == .getPeerScores or command == .getGossipDiagnostics;
}
pub const Dial = struct {
    peer: n.PeerId,
    addresses: [2]n.Address,
    address_count: u8,
    timeout_ms: u64,
};
pub const Input = union(enum) {
    applyIntent: n.application_state.Update,
    updateStatus: n.peers.types.Status,
    getPeerScores,
    getGossipDiagnostics: u16,
    connect: Dial,
    disconnect: n.PeerId,
    reStatusPeers: struct { peers: [256]n.PeerId, count: u16 },
    addDirectPeer: Dial,
    removeDirectPeer: n.PeerId,
    getMetrics,
};

const Runtime = @import("network_runtime.zig").Runtime;
pub fn execute(self: *Runtime, token: Token, timestamp: n.Now) void {
    const cell = self.bridge.commands.get(token);
    executeOne(self, token.index, timestamp) catch |err| {
        std.log.scoped(.network_bridge).debug("command_failed command={s} operation={d}:{d} reason={s}", .{ @tagName(cell.input), token.index, token.generation, @errorName(err) });
        cell.failure = err;
    };
    network_owner.publishIdentity(self);
    self.lock();
    defer self.unlock();
    if (cell.state == .executing) {
        if (self.bridge.stop) cell.failure = self.bridge.terminal_error orelse error.NetworkClosed;
        self.bridge.commands.transition(cell, .terminal);
    }
    if (cell.state == .terminal) self.notifyIfReadyLocked();
}
fn executeOne(self: *Runtime, index: usize, timestamp: n.Now) !void {
    const operation = &self.bridge.commands.cells[index];
    const input = &operation.input;
    const core = &self.owner.?.core;
    switch (input.*) {
        .applyIntent => {
            const intent = &input.applyIntent;
            _ = try self.owner.?.state.?.apply(core, &self.owner.?.config.chain, intent, timestamp);
        },
        .updateStatus => {
            var status = input.updateStatus;
            if (self.owner.?.config.chain.fulu_scheduled and status.earliest_available_slot == null) return error.MissingAvailability;
            status.fork_digest = core.localState().status.fork_digest;
            try core.updateStatus(&status);
        },
        .getMetrics => network_owner.renderMetrics(self, timestamp),
        .getPeerScores => try self.bridge.diagnostics.?.captureScores(core, timestamp),
        .getGossipDiagnostics => |cursor| try n.gossipsub.diagnostics.capture(core.protocols.gossipsub, cursor, timestamp, &self.bridge.diagnostics.?.gossip),
        .removeDirectPeer => |*peer| operation.boolean = core.removeDirectPeer(peer),
        .addDirectPeer => |*dial| try core.addDirectPeer(&dial.peer, dial.addresses[0..dial.address_count], timestamp),
        .connect => |*dial| {
            if (core.isConnected(&dial.peer)) return;
            operation.deadline = timestamp.millis() +| dial.timeout_ms;
            try core.connectUntil(&dial.peer, dial.addresses[0..dial.address_count], timestamp, n.time.milliseconds(operation.deadline));
            self.lock();
            self.bridge.commands.transition(operation, .waiting);
            self.unlock();
        },
        .disconnect => |*peer| {
            core.cancelConnect(peer, timestamp);
            self.lock();
            for (&self.bridge.commands.cells, 0..) |*cell, i| {
                if (cell.state != .waiting or !self.bridge.commands.cells[i].input.connect.peer.eql(peer)) continue;
                self.bridge.commands.cells[i].failure = error.NetworkConnectCancelled;
                self.bridge.commands.transition(cell, .terminal);
            }
            self.unlock();
            _ = core.closePeer(peer, timestamp);
        },
        .reStatusPeers => |*targets| for (targets.peers[0..targets.count]) |*identity| {
            _ = core.reStatusPeer(identity, timestamp);
        },
    }
}
pub fn completeConnects(self: *Runtime, events: []const n.Event, timestamp: n.Now) void {
    self.lock();
    defer self.unlock();
    if (self.bridge.stop) return;
    if (latchConnects(&self.bridge.commands, events, timestamp)) self.notifyIfReadyLocked();
}

pub fn latchConnects(table: *Table, events: []const n.Event, timestamp: n.Now) bool {
    var terminal = false;
    for (&table.cells, 0..) |*cell, i| {
        if (cell.state != .waiting) continue;
        const operation = &table.cells[i];
        var connected = false;
        for (events) |event| if (event == .connected and event.connected.peer_id.eql(&operation.input.connect.peer)) {
            connected = true;
            break;
        };
        if (!connected and timestamp.millis() < operation.deadline) continue;
        operation.failure = if (connected) null else error.NetworkConnectTimeout;
        table.transition(cell, .terminal);
        terminal = true;
    }
    return terminal;
}
/// The earliest deadline of a connect waiting for its peer. Scans only while a connect is held.
pub fn connectDeadline(table: *const Table) ?u64 {
    if (table.connects == 0) return null;
    var deadline: ?u64 = null;
    for (&table.cells) |*cell| {
        if (cell.state == .waiting) deadline = @min(deadline orelse cell.deadline, cell.deadline);
    }
    return deadline;
}

test {
    _ = @import("network_commands_test.zig");
}
