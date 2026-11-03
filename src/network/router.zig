const std = @import("std");
const Negotiator = @import("negotiate.zig").Negotiator;
const Engine = @import("quic/Engine.zig");
const types = @import("types.zig");
const reqresp = @import("reqresp/protocol.zig");
const capability = @import("capabilities.zig");
const meshsub = @import("gossipsub/protocol.zig");
const Version = meshsub.Version;

pub const Router = struct {
    negotiator: Negotiator,
    supported: [capability.protocol_count]Negotiator.Protocol = undefined,
    supported_count: u8 = 0,
    available: capability.Set,
    active_capabilities: capability.Directional = .{ .receive = .initEmpty(), .request = .initEmpty() },
    meshsub_versions: [3]Version = undefined,
    meshsub_versions_count: u8,
    meshsub_candidates: [3]Negotiator.Protocol = undefined,
    meshsub_count: u8 = 0,
    /// The negotiator's results that `pump` translates. A field rather than a local so
    /// ReleaseSafe does not fill it every turn.
    raw_outcomes: [outcomes_per_pump]Negotiator.Outcome = undefined,

    pub const Kind = @import("protocol.zig").Kind;
    pub const Protocol = @import("protocol.zig").Protocol;
    pub const outcomes_per_pump: usize = 16;

    /// Leftover bytes remain borrowed until the next router pump. The selected
    /// handler must copy or consume them synchronously, including a coalesced FIN.
    /// The selection echo is queued, not necessarily sent.
    pub const Selection = struct { protocol: Protocol, leftover: []const u8, fin: bool };
    pub const Outcome = struct {
        stream: Engine.StreamHandle,
        direction: types.Direction,
        protocol: ?Protocol,
        result: union(enum) { ready: Selection, rejected, failed: Negotiator.Failure },
    };

    pub const Error = Negotiator.Error || error{ InvalidCapabilities, ProtocolDisabled };
    pub const Options = struct {
        capabilities: ?capability.Directional = null,
        negotiations_max: u16 = Negotiator.negotiations_max_default,
        outbound_control_reserved: u16 = 0,
        outbound_reserved: ?u16 = null,
        inbound_per_connection_max: u16 = 16,
        inbound_connections: u16 = 0,
        meshsub_versions: []const Version = &meshsub.versions,

        fn negotiation(options: Options) Negotiator.Options {
            return .{
                .negotiations_max = options.negotiations_max,
                .outbound_control_reserved = options.outbound_control_reserved,
                .outbound_reserved = options.outbound_reserved,
                .inbound_per_connection_max = options.inbound_per_connection_max,
                .inbound_connections = options.inbound_connections,
            };
        }
    };

    pub fn validateOptions(options: Options) Error!void {
        if (options.meshsub_versions.len == 0 or options.meshsub_versions.len > 3) {
            return error.InvalidLimits;
        }
        for (options.meshsub_versions, 0..) |version, index| {
            for (options.meshsub_versions[0..index]) |prior| {
                if (version == prior) return error.InvalidLimits;
            }
        }
        if (options.capabilities) |active| try validateSet(availableFor(options), active);
        try Negotiator.validateOptions(options.negotiation());
    }

    pub fn init(allocator: std.mem.Allocator, options: Options) Error!Router {
        try validateOptions(options);
        var negotiator = try Negotiator.init(allocator, options.negotiation());
        errdefer negotiator.deinit();
        var router: Router = .{
            .negotiator = negotiator,
            .available = availableFor(options),
            .meshsub_versions_count = @intCast(options.meshsub_versions.len),
        };
        @memcpy(router.meshsub_versions[0..options.meshsub_versions.len], options.meshsub_versions);
        router.setCapabilities(initialCapabilities(options));
        return router;
    }

    pub fn deinit(self: *Router) void {
        self.negotiator.deinit();
        self.* = undefined;
    }

    fn availableFor(options: Options) capability.Set {
        var available: capability.Set = .initEmpty();
        available.insert(.identify);
        for (std.enums.values(reqresp.Protocol)) |which| available.insert(.{ .reqresp = which });
        for (options.meshsub_versions) |version| available.insert(.{ .meshsub = version });
        return available;
    }

    pub fn initialCapabilities(options: Options) capability.Directional {
        const available = availableFor(options);
        return options.capabilities orelse .{ .receive = available, .request = available };
    }

    fn validateSet(available: capability.Set, active: capability.Directional) error{InvalidCapabilities}!void {
        if ((active.receive.bits | active.request.bits) & ~available.bits != 0) return error.InvalidCapabilities;
    }

    pub fn validateCapabilities(self: *const Router, active: capability.Directional) error{InvalidCapabilities}!void {
        try validateSet(self.available, active);
    }

    /// Applies to unselected proposals; accepted streams retain their protocol.
    pub fn setCapabilities(self: *Router, active: capability.Directional) void {
        self.validateCapabilities(active) catch unreachable;
        self.active_capabilities = active;
        self.supported_count = 0;
        self.meshsub_count = 0;
        for (std.enums.values(reqresp.Protocol)) |which| {
            if (active.receive.contains(.{ .reqresp = which })) {
                self.supported[self.supported_count] = descriptor(.{ .reqresp = which });
                self.supported_count += 1;
            }
        }
        for (self.meshsub_versions[0..self.meshsub_versions_count]) |version| {
            const protocol: Protocol = .{ .meshsub = version };
            if (active.receive.contains(protocol)) {
                self.supported[self.supported_count] = descriptor(protocol);
                self.supported_count += 1;
            }
            if (active.request.contains(protocol)) {
                self.meshsub_candidates[self.meshsub_count] = descriptor(protocol);
                self.meshsub_count += 1;
            }
        }
        if (active.receive.contains(.identify)) {
            self.supported[self.supported_count] = descriptor(.identify);
            self.supported_count += 1;
        }
        std.debug.assert(self.supported_count == active.receive.count());
    }

    pub fn capabilities(self: *const Router) capability.Directional {
        return self.active_capabilities;
    }

    pub fn cancel(self: *Router, engine: *Engine, stream: Engine.StreamHandle) void {
        self.negotiator.cancel(engine, stream);
    }

    pub fn beginOutbound(
        self: *Router,
        engine: *Engine,
        conn: Engine.Handle,
        protocol: Protocol,
        now: types.Now,
    ) Error!Engine.StreamHandle {
        if (!self.active_capabilities.request.contains(protocol)) return error.ProtocolDisabled;
        return self.negotiator.beginOutbound(engine, conn, &.{descriptor(protocol)}, now, .{
            .control = protocol == .reqresp and protocol.reqresp.isControl(),
        });
    }

    pub fn beginReqRespTimed(
        self: *Router,
        engine: *Engine,
        conn: Engine.Handle,
        protocol: reqresp.Protocol,
        now: types.Now,
        timeout: std.Io.Duration,
    ) Error!Engine.StreamHandle {
        if (!self.active_capabilities.request.contains(.{ .reqresp = protocol })) return error.ProtocolDisabled;
        if (timeout.nanoseconds <= 0) return error.InvalidLimits;
        const timeout_ms = now.deadlineMilliseconds(timeout) - now.millis();
        return self.negotiator.beginOutbound(engine, conn, &.{descriptor(.{ .reqresp = protocol })}, now, .{ .control = protocol.isControl(), .timeout_ms = timeout_ms });
    }

    pub fn beginMeshsub(
        self: *Router,
        engine: *Engine,
        conn: Engine.Handle,
        now: types.Now,
    ) Error!Engine.StreamHandle {
        if (self.meshsub_count == 0) return error.ProtocolDisabled;
        return self.negotiator.beginOutbound(engine, conn, self.meshsub_candidates[0..self.meshsub_count], now, .{});
    }

    pub fn transportEvents(
        self: *Router,
        engine: *Engine,
        events: []const Engine.Event,
        now: types.Now,
    ) void {
        for (events) |event| switch (event) {
            .stream_opened => |stream| {
                self.negotiator.acceptInbound(engine, stream, now) catch {
                    engine.closeStream(stream, types.app_error_negotiation_failed);
                };
            },
            .closed => |closed| self.negotiator.connectionClosed(engine, closed.conn),
            else => {},
        };
    }

    pub fn finishSelected(self: *Router, engine: *Engine, stream: Engine.StreamHandle, bytes: []const u8, now: types.Now) bool {
        return self.negotiator.finishSelected(engine, stream, bytes, now);
    }

    /// Ends the leftover borrows of the outcomes the last pump returned.
    pub fn releaseOutcomes(self: *Router) void {
        self.negotiator.releaseReported();
    }

    pub fn schedule(self: *const Router, outcome_capacity: usize) types.Schedule {
        return self.negotiator.schedule(outcome_capacity);
    }

    pub fn pump(self: *Router, engine: *Engine, now: types.Now, out: []Outcome) usize {
        std.debug.assert(out.len <= outcomes_per_pump);
        const raw = self.raw_outcomes[0..out.len];
        const count = self.negotiator.pump(engine, now, self.supported[0..self.supported_count], raw);
        for (raw[0..count], out[0..count]) |result, *outcome| {
            if (result.direction == .inbound and result.result == .failed) {
                std.log.scoped(.network_quic).debug("inbound_negotiation_failed connection={d}:{d} stream={d} reason={s}", .{ result.stream.conn.index, result.stream.conn.generation, result.stream.id, @tagName(result.result.failed) });
            }
            const selected: ?Protocol = if (result.protocol_index) |index| Protocol.fromIndex(index) else null;
            if (result.result == .ready) if (engine.stream_capture) |capture| {
                capture.selected(result.stream, selected.?, result.direction, result.result.ready.leftover);
            };
            outcome.* = .{
                .stream = result.stream,
                .direction = result.direction,
                .protocol = selected,
                .result = switch (result.result) {
                    .ready => |ready| .{ .ready = .{
                        .protocol = selected.?,
                        .leftover = ready.leftover,
                        .fin = ready.fin,
                    } },
                    .rejected => .rejected,
                    .failed => |failure| .{ .failed = failure },
                },
            };
        }
        return count;
    }

    fn descriptor(protocol: Protocol) Negotiator.Protocol {
        return .{ .id = protocol.id(), .index = protocol.index() };
    }

    comptime {
        std.debug.assert(capability.protocol_count <= Negotiator.supported_max);
    }
};

test {
    _ = @import("router_test.zig");
}
