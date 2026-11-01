const std = @import("std");
const builtin = @import("builtin");
const Promise = @import("network_promise.zig");
const n = @import("network");
const rr = n.reqresp;
const Runtime = @import("network_runtime.zig").Runtime;

const Budget = @import("network_budget.zig").Budget;
pub const Token = struct { index: u8, generation: u64 };
pub const State = enum { free, queued, copying, serving, response_preparing, response_queued, response_native, terminal };
pub const Failure = enum { timeout, host_timeout, quota_timeout, cancelled, connection_closed, stream_closed, transport };
pub const Rejection = enum { invalid_context, unknown_fork, chunk_too_large, chunk_too_small, too_many_chunks, invalid_error };
pub const Ack = union(enum) { sent, rejected: Rejection, failed: Failure, closed };
pub const Action = enum { none, finish, fail, cancel, submitted };
pub const Cell = struct {
    response_promise: Promise = .{},
    permission_promise: Promise = .{},
    closed_promise: Promise = .{},

    state: State = .free,
    generation: u64 = 0,
    sequence: u64 = 0,
    identity: n.PeerId = undefined,
    connection: n.quic.Engine.Handle = undefined,
    handle: rr.ReqResp.RequestHandle = undefined,
    native: bool = false,
    serving: ?rr.ReqResp.ServingHandle = null,
    release_requested: bool = false,
    protocol: rr.Protocol = .blocks_by_root_v2,
    input: []u8 = &.{},
    response: []u8 = &.{},
    reservation: usize = 0,
    response_reservation: usize = 0,
    context: ?n.types.ForkEntry = null,
    copying: bool = false,
    exposed: bool = false,
    /// The host's stream awaits its close, which an exchange delivers once the stream ends.
    closed_awaited: bool = false,
    /// A response awaits its acknowledgement, `ack`.
    response_awaited: bool = false,
    /// A readiness call awaits its permission, granted once `permission_ready`.
    permission_awaited: bool = false,
    permission_ready: bool = false,
    ack: ?Ack = null,
    chunks: u32 = 0,
    action: Action = .none,
    error_status: u8 = 0,
    error_message: [256]u8 = undefined,
    error_len: u16 = 0,
};
/// What an exchange delivers for one due cell: the pending response's acknowledgement, the stream's close and the
/// pending permission's outcome, whichever are due, in that order.
pub const Completion = struct {
    token: Token,
    ack: ?Ack = null,
    closed: bool = false,
    /// Whether the pending permission was granted.
    permission: ?bool = null,
};
pub const Diagnostics = struct {
    capacity: usize = 0,
    occupied: usize = 0,
    queued: usize = 0,
    highWater: usize = 0,
    pendingResponses: usize = 0,
    pendingPermissions: usize = 0,
    closedPromises: usize = 0,
    reservedBytes: usize = 0,
    reservedBytesHighWater: usize = 0,
    requestBytes: usize = 0,
    responseBytes: usize = 0,
    copyingBytes: usize = 0,
    requestsTaken: u64 = 0,
    responseBytesCopied: u64 = 0,
    chunksWritten: u64 = 0,
    bytesWritten: u64 = 0,
    retiring: usize = 0,
    capacityRefusals: u64 = 0,
    byteRefusals: u64 = 0,
};
pub const capacity_max = 32;
pub const Table = struct {
    cells: []Cell,
    /// The cells whose completion is due now. `refresh` keeps it current after each change to a cell.
    due: std.StaticBitSet(capacity_max) = .empty,
    /// Past the last delivered cell, where delivery resumes, so refilled low cells cannot starve higher ones.
    completion_cursor: usize = 0,
    backing: std.mem.Allocator,
    budget: *Budget,
    diag: Diagnostics = .{},
    sequence: u64 = 0,
    cursor: usize = 0,

    pub fn init(backing: std.mem.Allocator, capacity: usize, budget: *Budget) !Table {
        std.debug.assert(capacity <= capacity_max);
        const cells = try backing.alloc(Cell, capacity);
        @memset(cells, .{});
        return .{ .cells = cells, .backing = backing, .budget = budget, .diag = .{ .capacity = capacity } };
    }
    pub fn deinit(self: *Table) void {
        std.debug.assert(self.diag.occupied == 0);
        self.backing.free(self.cells);
    }
    pub fn get(self: *Table, token: Token) ?*Cell {
        if (token.index >= self.cells.len) return null;
        const cell = &self.cells[token.index];
        return if (cell.state != .free and cell.generation == token.generation) cell else null;
    }
    pub fn reserve(self: *Table, protocol: rr.Protocol, len: usize) !Token {
        std.debug.assert(len >= protocol.info().request_min and len <= protocol.info().request_max);
        const amount = try std.math.mul(usize, len, 2);
        var selected: ?Token = null;
        for (self.cells, 0..) |*cell, i| {
            if (cell.state != .free or cell.generation == std.math.maxInt(u64)) continue;
            selected = .{ .index = @intCast(i), .generation = cell.generation + 1 };
            break;
        }
        const token = selected orelse {
            self.diag.capacityRefusals +|= 1;
            return error.NetworkIncomingFull;
        };
        if (self.sequence == std.math.maxInt(u64)) return error.IncomingSequenceExhausted;
        self.budget.reserve(.incoming, amount) catch |err| {
            self.diag.byteRefusals +|= 1;
            return err;
        };
        self.sequence += 1;
        self.cells[token.index] = .{ .state = .queued, .generation = token.generation, .sequence = self.sequence, .protocol = protocol, .reservation = amount };
        self.refresh(&self.cells[token.index]);
        self.diag.occupied += 1;
        self.diag.highWater = @max(self.diag.highWater, self.diag.occupied);
        self.diag.reservedBytes += amount;
        self.diag.reservedBytesHighWater = @max(self.diag.reservedBytesHighWater, self.diag.reservedBytes);
        return token;
    }
    pub fn allocate(self: *Table, token: Token, input: []const u8) !void {
        const cell = self.get(token).?;
        std.debug.assert(cell.state == .queued and cell.input.len == 0);
        cell.input = try self.backing.dupe(u8, input);
    }
    fn refund(self: *Table, cell: *Cell, amount: usize) void {
        self.budget.release(.incoming, amount);
        self.diag.reservedBytes -= amount;
        cell.reservation -= amount;
    }
    pub fn releaseInput(self: *Table, cell: *Cell) void {
        const amount = cell.input.len * 2;
        self.backing.free(cell.input);
        cell.input = &.{};
        self.refund(cell, amount);
    }
    pub fn releaseResponse(self: *Table, cell: *Cell) void {
        self.backing.free(cell.response);
        cell.response = &.{};
        self.refund(cell, cell.response_reservation);
        cell.response_reservation = 0;
    }
    pub fn reserveResponse(self: *Table, cell: *Cell, len: usize) !void {
        std.debug.assert(len <= cell.protocol.info().response_max);
        if (len <= cell.response_reservation) {
            self.refund(cell, cell.response_reservation - len);
            cell.response_reservation = len;
            return;
        }
        const amount = len - cell.response_reservation;
        try self.budget.reserve(.incoming, amount);
        cell.response_reservation = len;
        cell.reservation += amount;
        self.diag.reservedBytes += amount;
        self.diag.reservedBytesHighWater = @max(self.diag.reservedBytesHighWater, self.diag.reservedBytes);
    }
    pub fn releasePayload(self: *Table, cell: *Cell) void {
        if (cell.native or cell.copying or cell.state == .response_preparing) return;
        self.releaseInput(cell);
        self.releaseResponse(cell);
        self.refund(cell, cell.reservation);
    }
    pub fn retire(self: *Table, token: Token) void {
        const cell = self.get(token).?;
        std.debug.assert(!cell.native and !cell.copying and cell.serving == null);
        cell.state = .terminal;
        self.releasePayload(cell);
        cell.response_promise.deinit();
        cell.permission_promise.deinit();
        cell.closed_promise.deinit();
        cell.* = .{ .generation = cell.generation };
        self.refresh(cell);
        self.diag.occupied -= 1;
    }
    /// Recomputes whether the completion of `cell` is due.
    pub fn refresh(self: *Table, cell: *const Cell) void {
        const index = (@intFromPtr(cell) - @intFromPtr(self.cells.ptr)) / @sizeOf(Cell);
        std.debug.assert(&self.cells[index] == cell);
        self.due.setValue(index, completionReady(cell));
    }
    /// The first cell at or after `from` whose completion is due. O(1).
    pub fn nextDue(self: *const Table, from: usize) ?usize {
        var rest = self.due;
        rest.setRangeValue(.{ .start = 0, .end = @min(from, capacity_max) }, false);
        return rest.findFirstSet();
    }
    /// Whether the completion of any cell is due. O(1); debug builds check it against a scan.
    pub fn anyDue(self: *const Table) bool {
        if (builtin.mode == .Debug) for (0..capacity_max) |i| std.debug.assert(self.due.isSet(i) == (i < self.cells.len and completionReady(&self.cells[i])));
        return self.due.findFirstSet() != null;
    }
    /// Pins the due cell at `index` for delivery, with what is due of its acknowledgement, close and permission.
    pub fn pin(self: *Table, index: usize) Completion {
        const cell = &self.cells[index];
        defer self.refresh(cell);
        defer cell.copying = true;
        return .{
            .token = .{ .index = @intCast(index), .generation = cell.generation },
            .ack = if (cell.response_awaited) cell.ack else null,
            .closed = !cell.native and cell.closed_awaited,
            .permission = if (cell.permission_awaited and (cell.permission_ready or !cell.native)) cell.native and cell.permission_ready else null,
        };
    }
    /// Commits a delivered completion, retiring a cell that ended and holds nothing more. Returns whether the owner now
    /// returns the cell's retained serving slot.
    pub fn commit(self: *Table, completion: Completion) bool {
        const cell = self.get(completion.token).?;
        cell.copying = false;
        if (completion.ack != null) {
            cell.response_awaited = false;
            cell.ack = null;
        }
        if (completion.closed) cell.closed_awaited = false;
        if (completion.permission != null) {
            cell.permission_awaited = false;
            cell.permission_ready = false;
        }
        self.releasePayload(cell);
        self.refresh(cell);
        if (!cell.native and cell.serving == null and !awaited(cell)) {
            self.retire(completion.token);
            return false;
        }
        return releasable(cell);
    }
    pub fn pinStart(self: *Table) ?Token {
        const token = self.oldest() orelse return null;
        const cell = self.get(token).?;
        cell.copying = true;
        cell.state = .copying;
        self.refresh(cell);
        return token;
    }
    pub fn commitStart(self: *Table, token: Token) void {
        const cell = self.get(token).?;
        std.debug.assert(cell.copying and !cell.exposed);
        cell.closed_awaited = true;
        cell.copying = false;
        cell.exposed = true;
        self.diag.requestsTaken +|= 1;
        self.releaseInput(cell);
        cell.state = if (cell.native) .serving else .terminal;
        self.releasePayload(cell);
        self.refresh(cell);
    }
    pub fn oldest(self: *Table) ?Token {
        var selected: ?Token = null;
        var sequence: u64 = std.math.maxInt(u64);
        for (self.cells, 0..) |*cell, i| {
            if (cell.state != .queued or !cell.native) continue;
            if (selected == null or cell.sequence < sequence) {
                selected = .{ .index = @intCast(i), .generation = cell.generation };
                sequence = cell.sequence;
            }
        }
        return selected;
    }
    pub fn snapshot(self: *const Table) Diagnostics {
        var result = self.diag;
        for (self.cells) |*cell| {
            if (cell.state == .free) continue;
            result.queued += @intFromBool(cell.state == .queued);
            result.retiring += @intFromBool(!cell.native and cell.serving != null);
            result.closedPromises += @intFromBool(cell.closed_awaited);
            result.pendingResponses += @intFromBool(cell.response_awaited);
            result.pendingPermissions += @intFromBool(cell.permission_awaited);
            result.requestBytes += cell.input.len;
            if (cell.state != .response_preparing) result.responseBytes += cell.response.len;
            if (cell.copying) result.copyingBytes += cell.input.len;
        }
        return result;
    }
};

fn rejection(err: rr.ReqResp.RespondError) error{ Terminal, StaleHandle, Busy }!Rejection {
    return switch (err) {
        error.InvalidContext => .invalid_context,
        error.UnknownFork => .unknown_fork,
        error.ChunkTooLarge => .chunk_too_large,
        error.ChunkTooSmall => .chunk_too_small,
        error.TooManyChunks => .too_many_chunks,
        error.InvalidError => .invalid_error,
        error.Terminal => error.Terminal,
        error.StaleHandle => error.StaleHandle,
        error.Busy => error.Busy,
    };
}
fn failure(reason: rr.ReqResp.Failure) !Failure {
    return switch (reason) {
        .timeout => .timeout,
        .host_timeout => .host_timeout,
        .quota_timeout => .quota_timeout,
        .cancelled => .cancelled,
        .connection_closed => .connection_closed,
        .stream_closed => .stream_closed,
        .transport => .transport,
        else => error.InvalidIncomingFailure,
    };
}
/// Whether the host awaits a close, an acknowledgement or a permission of the cell.
fn awaited(cell: *const Cell) bool {
    return cell.closed_awaited or cell.response_awaited or cell.permission_awaited;
}
/// A completion an exchange delivers now: a write acknowledgement, the close of a finished stream, or a response
/// permission.
pub fn completionReady(cell: *const Cell) bool {
    if (cell.state == .free or cell.copying or cell.state == .response_preparing) return false;
    return (cell.ack != null and cell.response_awaited) or (!cell.native and cell.closed_awaited) or ((cell.permission_ready or !cell.native) and cell.permission_awaited);
}
/// A retained serving slot whose host released it and awaits nothing, so the owner returns it.
pub fn releasable(cell: *const Cell) bool {
    return cell.serving != null and cell.release_requested and !cell.native and !cell.copying and !awaited(cell);
}
fn needsPermission(cell: *const Cell) bool {
    return cell.state == .serving and !cell.permission_ready and
        (cell.permission_awaited or (cell.response_awaited and cell.ack == null));
}
/// Work the owner does for a cell at its next host apply: a release or a response permission.
fn ownerWork(cell: *const Cell) bool {
    if (cell.state == .free) return false;
    return releasable(cell) or (cell.native and needsPermission(cell));
}
/// Applies releases, cancels, response permissions, queued responses and terminal actions.
/// Returns whether the per-turn response cap left queued responses for the next turn.
pub fn applyPending(runtime: *Runtime, now: n.Now) !bool {
    runtime.lock();
    defer runtime.unlock();
    const table = if (runtime.bridge.incoming) |*table| table else return false;
    if (table.cells.len == 0) return false;
    var submissions: usize = 0;
    var more = false;
    // Check for notifications after every cell has refreshed its completion state.
    defer runtime.notifyIfReadyLocked();
    for (0..table.cells.len) |offset| {
        const cell = &table.cells[(table.cursor + offset) % table.cells.len];
        defer table.refresh(cell);
        if (releasable(cell)) {
            const released = runtime.owner.?.core.releaseServing(cell.serving.?);
            std.debug.assert(released);
            cell.serving = null;
            table.retire(.{ .index = @intCast((table.cursor + offset) % table.cells.len), .generation = cell.generation });
            continue;
        }
        if (!cell.native) continue;
        const core = &runtime.owner.?.core;
        if (cell.action == .cancel or runtime.bridge.stop) {
            _ = core.cancelRequest(cell.handle, now);
            continue;
        }
        if (needsPermission(cell) and core.responseReadiness(cell.handle) == .ready) {
            table.reserveResponse(cell, cell.protocol.info().response_max) catch {
                // A payload release wakes the owner to retry.
                table.budget.waiting = true;
                continue;
            };
            if (cell.permission_awaited) cell.permission_ready = true else cell.ack = .sent;
        }
        if (cell.state == .response_queued and submissions == 4) more = true;
        if (cell.state == .response_queued and submissions < 4) {
            submissions += 1;
            core.respond(cell.handle, cell.response, cell.context, now) catch |err| {
                if (err == error.Terminal) continue;
                cell.ack = .{ .rejected = try rejection(err) };
                table.releaseResponse(cell);
                cell.state = .serving;
                continue;
            };
            cell.state = .response_native;
        }
        switch (cell.action) {
            .finish => if (core.finishResponse(cell.handle, now)) {
                cell.action = .submitted;
            },
            .fail => {
                core.respondError(cell.handle, cell.error_status, cell.error_message[0..cell.error_len], now) catch |err| switch (err) {
                    error.Terminal => continue,
                    error.StaleHandle,
                    error.Busy,
                    error.InvalidError,
                    error.InvalidContext,
                    error.UnknownFork,
                    error.ChunkTooLarge,
                    error.ChunkTooSmall,
                    error.TooManyChunks,
                    => return err,
                };
                cell.action = .submitted;
            },
            else => {},
        }
    }
    table.cursor = (table.cursor + 4) % table.cells.len;
    return more;
}
pub fn captureLocked(runtime: *Runtime, event: rr.ReqResp.Event, now: n.Now) !void {
    const table = if (runtime.bridge.incoming) |*table| table else return;
    if (event == .request) return admitLocked(runtime, event.request, now) catch |err| switch (@as(anyerror, err)) {
        error.OutOfMemory => {
            runtime.operational_failures +|= 1;
            runtime.owner.?.core.respondError(event.request.request, 2, "local serving allocation failed", now) catch {
                _ = runtime.owner.?.core.cancelRequest(event.request.request, now);
            };
        },
        else => return err,
    };
    const handle = switch (event) {
        .chunk_sent => |e| e.request,
        .served => |e| e.request,
        .failed => |e| e.request,
        else => return,
    };
    if (handle.direction != .inbound) return;
    for (table.cells, 0..) |*cell, i| {
        if (cell.state == .free or !cell.native or !std.meta.eql(cell.handle, handle)) continue;
        switch (event) {
            .chunk_sent => |sent| {
                if (cell.state != .response_native) return error.InvalidIncomingAcknowledgement;
                if (sent.chunks != cell.chunks + 1) return error.InvalidIncomingAcknowledgement;
                std.debug.assert(cell.response_awaited and cell.ack == null);
                cell.chunks = sent.chunks;
                // Complete respond only after the next chunk's capacity is reserved in applyPending.
                table.diag.chunksWritten +|= 1;
                table.diag.bytesWritten +|= cell.response.len;
                table.releaseResponse(cell);
                cell.state = .serving;
            },
            .served => |served| {
                if (served.chunks != cell.chunks) return error.InvalidIncomingAcknowledgement;
                cell.native = false;
            },
            .failed => |failed| {
                const reason = try failure(failed.reason);
                if (cell.response_awaited and cell.ack == null and !runtime.bridge.stop) cell.ack = .{ .failed = reason };
                cell.native = false;
            },
            else => unreachable,
        }
        if (!cell.native) {
            if (cell.response_awaited and cell.ack == null) {
                std.debug.assert(runtime.bridge.stop);
                cell.ack = .closed;
            }
            if (cell.state != .response_preparing) cell.state = .terminal;
            table.releasePayload(cell);
            if (!cell.exposed and !cell.copying) {
                if (cell.serving != null) {
                    const released = runtime.owner.?.core.releaseServing(cell.serving.?);
                    std.debug.assert(released);
                    cell.serving = null;
                }
                table.retire(.{ .index = @intCast(i), .generation = cell.generation });
            }
        }
        table.refresh(cell);
        runtime.notifyIfReadyLocked();
        if (ownerWork(cell)) runtime.host_due = true;
        break;
    }
}
fn admitLocked(runtime: *Runtime, request: @FieldType(rr.ReqResp.Event, "request"), now: n.Now) !void {
    const table = &runtime.bridge.incoming.?;
    const core = &runtime.owner.?.core;
    const identity = core.peerIdentity(request.conn) orelse {
        _ = core.cancelRequest(request.request, now);
        return;
    };
    const token = table.reserve(request.protocol, request.bytes.len) catch |err| switch (err) {
        error.NetworkIncomingFull, error.NetworkBridgeFull => {
            core.respondError(request.request, 2, "application capacity exhausted", now) catch {
                _ = core.cancelRequest(request.request, now);
            };
            return;
        },
        else => return err,
    };
    errdefer table.retire(token);
    try table.allocate(token, request.bytes);
    const cell = table.get(token).?;
    cell.identity = identity;
    cell.connection = request.conn;
    cell.handle = request.request;
    cell.native = true;
    cell.serving = core.retainServing(request.request) orelse unreachable;
    table.refresh(cell);
    runtime.notifyIfReadyLocked();
}
/// Ends every stream at the owner's quiescence. With no owner left to return serving slots, a cell the host awaits
/// nothing more of retires now, also one whose close the host already took and whose release may come later.
pub fn closeLocked(runtime: *Runtime) void {
    if (runtime.bridge.incoming) |*table| for (table.cells, 0..) |*cell, i| {
        if (cell.state == .free) continue;
        cell.native = false;
        cell.serving = null;
        if (cell.response_awaited and cell.ack == null) cell.ack = .closed;
        if (cell.state != .response_preparing) cell.state = .terminal;
        table.releasePayload(cell);
        table.refresh(cell);
        if (!awaited(cell) and !cell.copying) table.retire(.{ .index = @intCast(i), .generation = cell.generation });
    };
}
test {
    _ = @import("network_incoming_test.zig");
}
