const std = @import("std");
const config = @import("config");
const constants = @import("constants.zig");
const request_policy = @import("request_policy.zig");
const admission_mod = @import("admission.zig");
const quotas = @import("quotas.zig");
const limits = @import("../quic/limits.zig");
const Protocol = @import("protocol.zig").Protocol;
const types = @import("../types.zig");
const ForkEntry = types.ForkEntry;

pub const Error = error{ InvalidOptions, InvalidQuota, InvalidPolicy };

/// Two maintenance and two gossip streams remain outside the application allowance.
pub const outbound_stream_headroom: u8 = 4;

pub fn validateForkTable(table: []const ForkEntry) error{InvalidOptions}!void {
    if (table.len > 64) return error.InvalidOptions;
    for (table, 0..) |entry, i| {
        for (table[0..i]) |old| {
            if (std.mem.eql(u8, &old.digest, &entry.digest)) return error.InvalidOptions;
        }
    }
}

pub const Options = struct {
    routes: Routes = .application,
    protocols: Protocol.Set = .all,
    report_non_completion: bool = true,

    connections: u16 = limits.connections_max_default,
    outbound_max: u16 = constants.outbound_max_default,
    /// Concurrent application executions. Control responses use their request storage.
    serving_max: u16 = constants.serving_max_default,
    /// Shared by IPv4 /32 or IPv6 /64, including host-retained executions after disconnect.
    /// Two concurrent sync batches can each request blocks and sidecars.
    serving_per_source_max: u8 = 2 * constants.MAX_CONCURRENT_REQUESTS,
    /// Zero disables the aggregate outbound limit.
    outbound_per_connection_max: u8 = 0,
    inbound_per_connection_max: u8 = constants.inbound_per_connection_max_default,
    /// Complete inbound request transfer and each response chunk within this duration.
    progress_timeout_ms: u64 = constants.progress_timeout_ms_default,
    forks: []const ForkEntry,
    request_fork: config.ForkSeq = .phase0,
    admission: Admission,
    host_timeout_ms: u64 = 60_000,
    quota_timeout_ms: u64 = 60_000,
    work_per_pump_max: u16 = 32,

    pub const Routes = struct {
        inbound: types.StreamOwner,
        outbound: types.StreamOwner,

        pub const application: Routes = .{ .inbound = .reqresp_inbound, .outbound = .reqresp_outbound };
        pub const control: Routes = .{ .inbound = .reqresp_control_inbound, .outbound = .reqresp_control_outbound };

        pub fn owner(self: Routes, direction: types.Direction) types.StreamOwner {
            return switch (direction) {
                .inbound => self.inbound,
                .outbound => self.outbound,
            };
        }
    };

    pub const Admission = struct {
        /// Control peers need independent maintenance allowances even when colocated.
        scope: std.meta.Tag(admission_mod.Key) = .address,
        policy: request_policy.Config,
        limits: quotas.Options,

        pub fn defaults(configuration: *const request_policy.Config, global_scale: u16) error{InvalidPolicy}!Admission {
            return .{ .policy = configuration.*, .limits = try quotas.Options.defaults(configuration, global_scale) };
        }
    };

    pub fn validate(options: Options) Error!void {
        if (options.admission.scope == .peer and options.protocols.bits & Protocol.Set.application.bits != 0) return error.InvalidOptions;
        if (options.protocols.len() == 0) return error.InvalidOptions;
        if (!std.meta.eql(options.routes, Routes.application) and !std.meta.eql(options.routes, Routes.control)) return error.InvalidOptions;
        _ = try request_policy.Policy.init(&options.admission.policy);
        _ = try admission_mod.Limiter.capacity(&options.admission.limits, options.protocols, options.connections);
        if (options.outbound_max == 0 or options.outbound_max > constants.slots_ceiling) {
            return error.InvalidOptions;
        }
        if (options.serving_max > constants.slots_ceiling) return error.InvalidOptions;
        if (options.protocols.bits & Protocol.Set.application.bits != 0 and
            (options.serving_max == 0 or options.serving_per_source_max == 0)) return error.InvalidOptions;
        if (options.outbound_per_connection_max > limits.peer_streams_bidi - outbound_stream_headroom or
            options.outbound_per_connection_max > options.outbound_max) return error.InvalidOptions;
        if (options.inbound_per_connection_max == 0 or options.connections == 0) return error.InvalidOptions;
        if (options.connections > constants.slots_ceiling) return error.InvalidOptions;
        if (options.progress_timeout_ms == 0 or options.host_timeout_ms == 0 or
            options.quota_timeout_ms == 0 or options.work_per_pump_max == 0 or
            options.work_per_pump_max > 2 * constants.slots_ceiling) return error.InvalidOptions;
        try validateForkTable(options.forks);
    }
};
