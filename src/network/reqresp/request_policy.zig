const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const constants = @import("constants");
const preset = @import("preset");
const Protocol = @import("protocol.zig").Protocol;
const ct = @import("consensus_types");
const constants_mod = @import("constants.zig");
const BeaconConfig = @import("config").BeaconConfig;
const protocol = @import("protocol.zig");

pub const Config = struct {
    slot_duration_ms: u64 = @import("config").mainnet.chain_config.SLOT_DURATION_MS,
    slot_duration_ms_heze: u64 = @import("config").mainnet.chain_config.SLOT_DURATION_MS_HEZE,
    deneb_start_slot: ?u64,
    blocks_pre_deneb: u32,
    blocks_deneb: u32,
    payloads: u32 = constants.MAX_REQUEST_PAYLOADS,
    gloas_column_max: u64 = constants_mod.MAX_PAYLOAD_SIZE,
    number_of_columns: u16,
    column_chunks: u32,
    host_integer_max: ?u64 = null,
    max_payload_size: usize = constants_mod.MAX_PAYLOAD_SIZE,

    pub fn fromBeaconConfig(cfg: *const BeaconConfig) error{InvalidPolicy}!Config {
        const chain = &cfg.chain;
        if (chain.BLOB_SCHEDULE.len > schedule_max) return error.InvalidPolicy;
        const result: Config = .{
            .slot_duration_ms = cfg.getSlotDurationMs(.fulu),
            .slot_duration_ms_heze = cfg.getSlotDurationMs(.heze),
            .deneb_start_slot = if (chain.DENEB_FORK_EPOCH == constants.FAR_FUTURE_EPOCH) null else std.math.mul(u64, chain.DENEB_FORK_EPOCH, preset.preset.SLOTS_PER_EPOCH) catch return error.InvalidPolicy,
            .blocks_pre_deneb = std.math.cast(u32, chain.MAX_REQUEST_BLOCKS) orelse return error.InvalidPolicy,
            .blocks_deneb = std.math.cast(u32, chain.MAX_REQUEST_BLOCKS_DENEB) orelse return error.InvalidPolicy,
            .payloads = std.math.cast(u32, chain.MAX_REQUEST_PAYLOADS) orelse return error.InvalidPolicy,
            .gloas_column_max = @import("response_bounds.zig").gloasColumnMax(chain),
            .number_of_columns = preset.NUMBER_OF_COLUMNS,
            .column_chunks = std.math.cast(u32, chain.MAX_REQUEST_DATA_COLUMN_SIDECARS) orelse return error.InvalidPolicy,
            .max_payload_size = std.math.cast(usize, chain.MAX_PAYLOAD_SIZE) orelse return error.InvalidPolicy,
        };
        _ = try Policy.init(&result);
        return result;
    }
};

pub const Inspection = struct {
    charged_cost: u128,
    chunks_max: u32,
};
pub const InspectError = error{ MalformedSsz, InvalidRequest, HostIntegerRange, UnsupportedBounds };
pub const schedule_max = 64;

pub const Policy = struct {
    config: Config,

    pub fn init(config: *const Config) error{InvalidPolicy}!Policy {
        for ([_]u64{ config.slot_duration_ms, config.slot_duration_ms_heze }) |duration| {
            if (duration == 0 or duration > 86_400_000) return error.InvalidPolicy;
        }
        if (config.max_payload_size < protocol.payloadMaxControl() or config.max_payload_size > constants_mod.MAX_PAYLOAD_SIZE or
            config.payloads == 0 or config.payloads > constants.MAX_REQUEST_PAYLOADS or
            config.gloas_column_max < ct.gloas.DataColumnSidecar.min_size or
            config.blocks_pre_deneb == 0 or config.blocks_pre_deneb > constants.MAX_REQUEST_BLOCKS or
            config.blocks_deneb == 0 or config.blocks_deneb > constants.MAX_REQUEST_BLOCKS_DENEB or
            config.number_of_columns != preset.NUMBER_OF_COLUMNS or
            config.column_chunks == 0 or config.column_chunks > preset.MAX_REQUEST_DATA_COLUMN_SIDECARS) return error.InvalidPolicy;
        return .{ .config = config.* };
    }

    pub fn requestBounds(self: *const Policy, which: Protocol, fork: ForkSeq) protocol.Info {
        var result = which.info();
        result.response_max = @min(result.response_max, self.config.max_payload_size);
        switch (which) {
            .execution_payload_envelopes_by_root_v1 => result.request_max = @as(usize, self.config.payloads) * 32,
            .blocks_by_root_v2 => result.request_max = @as(usize, self.blocks(fork)) * ct.primitive.Root.fixed_size,
            .data_column_sidecars_by_root_v1 => result.request_max = @as(usize, self.config.blocks_deneb) *
                (ct.fulu.DataColumnsByRootIdentifiers.max_size / constants.MAX_REQUEST_BLOCKS_DENEB),
            else => {},
        }
        result.request_max = @min(result.request_max, self.config.max_payload_size);
        if (which == .execution_payload_envelopes_by_range_v1 or which == .execution_payload_envelopes_by_root_v1) result.chunks_max = self.config.payloads;
        return result;
    }

    pub fn requestMax(self: *const Policy) usize {
        var maximum: usize = 0;
        for (std.enums.values(Protocol)) |which| maximum = @max(maximum, self.requestMaxFor(which));
        return maximum;
    }

    pub fn requestMaxFor(self: *const Policy, which: Protocol) usize {
        var maximum: usize = 0;
        for (std.enums.values(ForkSeq)) |fork| maximum = @max(maximum, self.requestBounds(which, fork).request_max);
        return maximum;
    }

    pub fn inspect(self: *const Policy, which: Protocol, bytes: []const u8, request_fork: ForkSeq) InspectError!Inspection {
        const bounds = self.requestBounds(which, request_fork);
        const intrinsic = which.info();
        if (bytes.len < intrinsic.request_min or bytes.len > intrinsic.request_max) return error.MalformedSsz;
        if (bytes.len > bounds.request_max) return error.UnsupportedBounds;
        var cost: u128 = 1;
        var ceiling: u128 = bounds.chunks_max;
        switch (which) {
            .blocks_by_range_v2, .data_column_sidecars_by_range_v1, .light_client_updates_by_range_v1, .execution_payload_envelopes_by_range_v1 => {
                const start = scalar(bytes, 0);
                const count = scalar(bytes, 8);
                if (count == 0 and which != .light_client_updates_by_range_v1) return error.InvalidRequest;
                try self.host(start);
                try self.host(count);
                const limit = switch (which) {
                    .blocks_by_range_v2 => if (self.config.deneb_start_slot != null and start >= self.config.deneb_start_slot.?) self.config.blocks_deneb else self.config.blocks_pre_deneb,
                    .light_client_updates_by_range_v1 => constants.MAX_REQUEST_LIGHT_CLIENT_UPDATES,
                    .execution_payload_envelopes_by_range_v1 => self.config.payloads,
                    else => self.config.blocks_deneb,
                };
                const effective = @min(count, limit);
                const end = std.math.add(u64, start, effective) catch return error.InvalidRequest;
                try self.host(end);
                cost = count;
                ceiling = effective;
                if (which == .data_column_sidecars_by_range_v1) {
                    if (offset(bytes, 16) != 20) return error.MalformedSsz;
                    const occurrences = try self.columns(bytes[20..]);
                    cost *= occurrences;
                    ceiling *= occurrences;
                }
            },
            .blocks_by_root_v2, .execution_payload_envelopes_by_root_v1 => {
                if (bytes.len % 32 != 0) return error.MalformedSsz;
                if (bytes.len / 32 > (if (which == .blocks_by_root_v2) self.blocks(request_fork) else self.config.payloads)) return error.UnsupportedBounds;
                cost = bytes.len / 32;
                ceiling = cost;
            },
            .data_column_sidecars_by_root_v1 => {
                cost = 0;
                if (bytes.len != 0) {
                    if (bytes.len < 4) return error.MalformedSsz;
                    const first: usize = offset(bytes, 0);
                    if (first == 0 or first % 4 != 0 or first > bytes.len or first / 4 > constants.MAX_REQUEST_BLOCKS_DENEB) return error.MalformedSsz;
                    if (first / 4 > self.config.blocks_deneb) return error.UnsupportedBounds;
                    const count = first / 4;
                    for (0..count) |i| {
                        const start: usize = offset(bytes, i * 4);
                        const end: usize = if (i + 1 < count) offset(bytes, (i + 1) * 4) else bytes.len;
                        if (start < first or end > bytes.len or start > end or end - start < 36) return error.MalformedSsz;
                        const element = bytes[start..end];
                        if (offset(element, 32) != 36) return error.MalformedSsz;
                        cost += try self.columns(element[36..]);
                    }
                }
                ceiling = cost;
            },
            .blocks_by_head_v1 => {
                const count = scalar(bytes, 32);
                if (count == 0) return error.InvalidRequest;
                try self.host(count);
                cost = count;
                ceiling = @min(count, self.config.blocks_deneb);
            },
            .status_v1, .status_v2 => {
                try self.host(scalar(bytes, 36));
                try self.host(scalar(bytes, 76));
                if (which == .status_v2) try self.host(scalar(bytes, 84));
            },
            .goodbye_v1, .inclusion_lists_by_indices_v1 => try self.host(scalar(bytes, 0)),
            .ping_v1 => {},
            .metadata_v1, .metadata_v2, .metadata_v3, .light_client_bootstrap_v1, .light_client_finality_update_v1, .light_client_optimistic_update_v1 => {},
        }
        const supported = if (which == .data_column_sidecars_by_range_v1 or which == .data_column_sidecars_by_root_v1)
            self.config.column_chunks
        else
            bounds.chunks_max;
        if (ceiling > supported) return error.UnsupportedBounds;
        return .{ .charged_cost = @max(1, cost), .chunks_max = @intCast(ceiling) };
    }

    fn columns(self: *const Policy, bytes: []const u8) InspectError!u64 {
        if (bytes.len % 8 != 0 or bytes.len / 8 > self.config.number_of_columns) return error.MalformedSsz;
        const count = bytes.len / 8;
        for (0..count) |i| try self.host(scalar(bytes, i * 8));
        return @intCast(count);
    }
    fn host(self: *const Policy, value: u64) InspectError!void {
        if (self.config.host_integer_max) |limit| if (value > limit) return error.HostIntegerRange;
    }
    pub fn blocks(self: *const Policy, fork: ForkSeq) u32 {
        return if (fork.gte(.deneb)) self.config.blocks_deneb else self.config.blocks_pre_deneb;
    }
};

fn scalar(bytes: []const u8, at: usize) u64 {
    std.debug.assert(at <= bytes.len and bytes.len - at >= 8);
    return std.mem.readInt(u64, bytes[at..][0..8], .little);
}
fn offset(bytes: []const u8, at: usize) u32 {
    std.debug.assert(at <= bytes.len and bytes.len - at >= 4);
    return std.mem.readInt(u32, bytes[at..][0..4], .little);
}
