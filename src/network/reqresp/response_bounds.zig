const std = @import("std");
const config = @import("config");
const ct = @import("consensus_types");
const codec = @import("codec.zig");
const constants = @import("constants.zig");

pub const Family = enum {
    block,
    blob,
    column,
    execution_payload,
    light_client_bootstrap,
    light_client_update,
    light_client_finality_update,
    light_client_optimistic_update,
};

fn typeBounds(comptime T: type) codec.Bounds {
    return .{
        .min = if (@hasDecl(T, "fixed_size")) T.fixed_size else T.min_size,
        .max = @min(if (@hasDecl(T, "fixed_size")) T.fixed_size else T.max_size, constants.MAX_PAYLOAD_SIZE),
    };
}

pub fn forFork(family: Family, fork: config.ForkSeq) error{InvalidResponseContext}!codec.Bounds {
    switch (fork) {
        inline else => |selected| {
            const types = @field(ct, @tagName(selected));
            return switch (family) {
                .block => typeBounds(types.SignedBeaconBlock),
                .blob => if (comptime selected.gte(.deneb)) typeBounds(types.BlobSidecar) else error.InvalidResponseContext,
                .column => if (comptime selected.gte(.fulu)) typeBounds(types.DataColumnSidecar) else error.InvalidResponseContext,
                .execution_payload => if (comptime selected.gte(.gloas)) typeBounds(types.SignedExecutionPayloadEnvelope) else error.InvalidResponseContext,
                .light_client_bootstrap => if (comptime selected.gte(.altair)) typeBounds(types.LightClientBootstrap) else error.InvalidResponseContext,
                .light_client_update => if (comptime selected.gte(.altair)) typeBounds(types.LightClientUpdate) else error.InvalidResponseContext,
                .light_client_finality_update => if (comptime selected.gte(.altair)) typeBounds(types.LightClientFinalityUpdate) else error.InvalidResponseContext,
                .light_client_optimistic_update => if (comptime selected.gte(.altair)) typeBounds(types.LightClientOptimisticUpdate) else error.InvalidResponseContext,
            };
        },
    }
}

pub fn unionFor(family: Family) codec.Bounds {
    var bounds = codec.Bounds{ .min = constants.MAX_PAYLOAD_SIZE, .max = 0 };
    inline for (std.enums.values(config.ForkSeq)) |fork| {
        if (forFork(family, fork)) |selected| {
            bounds.min = @min(bounds.min, selected.min);
            bounds.max = @max(bounds.max, selected.max);
        } else |_| {}
    }
    std.debug.assert(bounds.min <= bounds.max);
    return bounds;
}

/// Progressive SSZ columns use the largest configured blob count across all epochs.
pub fn gloasColumnMax(chain: *const config.ChainConfig) u64 {
    std.debug.assert(chain.BLOB_SCHEDULE.len <= @import("request_policy.zig").schedule_max);
    var blobs = chain.MAX_BLOBS_PER_BLOCK_ELECTRA;
    for (chain.BLOB_SCHEDULE) |point| blobs = @max(blobs, point.MAX_BLOBS_PER_BLOCK);
    return ct.gloas.DataColumnSidecar.min_size +| blobs *| (ct.fulu.Cell.fixed_size + ct.primitive.KZGProof.fixed_size);
}
