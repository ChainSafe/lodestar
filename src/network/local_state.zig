//! Values shared by chain state, protocol codecs and peer policy. Validation distinguishes
//! remote metadata (zero custody is allowed) from a complete local serving advertisement.
const std = @import("std");
const preset = @import("preset");
const advertisement = @import("advertisement.zig");
const capabilities_mod = @import("capabilities.zig");
pub const ForkSeq = @import("config").ForkSeq;

pub const Status = struct {
    fork_digest: [4]u8 = @splat(0),
    finalized_root: [32]u8 = @splat(0),
    finalized_epoch: u64 = 0,
    head_root: [32]u8 = @splat(0),
    head_slot: u64 = 0,
    earliest_available_slot: ?u64 = null,
};
pub const Metadata = struct {
    seq_number: u64 = 0,
    attnets: [8]u8 = @splat(0),
    syncnets: u8 = 0,
    /// A smaller count is a lower bound on the peer's custody prefix; zero advertises no custody.
    custody_group_count: ?u64 = null,
};
pub const ForkContext = struct {
    fork: ForkSeq = .phase0,
    digest: [4]u8 = @splat(0),
    custody_groups: u16 = @min(128, preset.NUMBER_OF_COLUMNS),
    minimum_sampling_groups: u16 = 0,
    custody_requirement: u16 = 0,

    pub fn validate(self: ForkContext) error{InvalidForkContext}!void {
        if (self.custody_groups == 0 or self.custody_groups > 128 or
            self.minimum_sampling_groups > self.custody_groups or
            self.custody_requirement > self.custody_groups or
            preset.NUMBER_OF_COLUMNS % self.custody_groups != 0)
            return error.InvalidForkContext;
    }
};
pub const LocalState = struct {
    status: Status = .{},
    metadata: Metadata = .{},
    fork: ForkContext = .{},
};

pub const ForkSchedule = struct {
    fulu_scheduled: bool = false,
    next_version: [4]u8 = @splat(0),
    next_epoch: u64 = std.math.maxInt(u64),
    next_digest: [4]u8 = @splat(0),
};
pub const LocalUpdate = struct {
    local: LocalState,
    schedule: ForkSchedule,
    endpoints: ?advertisement.Endpoints,
    capabilities: capabilities_mod.Directional,
};

pub const ValidationError = error{
    InvalidSyncnets,
    InvalidCustodyCount,
    InvalidForkContext,
    MissingAvailability,
    InvalidForkDigest,
    MissingCustodyAdvertisement,
};

pub fn validateMetadata(metadata: *const Metadata, fork: ForkContext) ValidationError!void {
    try fork.validate();
    if (metadata.syncnets & 0xf0 != 0) return error.InvalidSyncnets;
    if (metadata.custody_group_count) |count| {
        if (count > fork.custody_groups) return error.InvalidCustodyCount;
    }
}

pub fn validateLocalMetadata(metadata: *const Metadata, fork: ForkContext) ValidationError!void {
    try validateMetadata(metadata, fork);
    if (metadata.custody_group_count == 0) return error.InvalidCustodyCount;
}

pub fn copyLocal(out: *LocalState, source: *const LocalState) ValidationError!void {
    try validateLocalMetadata(&source.metadata, source.fork);
    if (!std.mem.eql(u8, &source.status.fork_digest, &source.fork.digest))
        return error.InvalidForkDigest;
    if (source.fork.fork.gte(.fulu)) {
        if (source.status.earliest_available_slot == null) return error.MissingAvailability;
        if (source.metadata.custody_group_count == null) return error.InvalidCustodyCount;
    }
    out.* = source.*;
}

pub fn copyServingLocal(out: *LocalState, source: *const LocalState, receive: capabilities_mod.Set) ValidationError!void {
    if (receive.contains(.{ .reqresp = .metadata_v3 }) and source.metadata.custody_group_count == null)
        return error.MissingCustodyAdvertisement;
    if (receive.contains(.{ .reqresp = .status_v2 }) and source.status.earliest_available_slot == null)
        return error.MissingAvailability;
    try copyLocal(out, source);
}

test {
    _ = @import("local_state_test.zig");
}
