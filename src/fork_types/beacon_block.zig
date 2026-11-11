const std = @import("std");
const ForkSeq = @import("config").ForkSeq;

const BlockType = @import("./block_type.zig").BlockType;
const ForkTypes = @import("./fork_types.zig").ForkTypes;
const ExecutionPayload = @import("./execution_payload.zig").ExecutionPayload;
const ExecutionPayloadHeader = @import("./execution_payload.zig").ExecutionPayloadHeader;

pub fn SignedBeaconBlock(comptime bt: BlockType, comptime f: ForkSeq) type {
    if (bt == .blinded and f.gte(.gloas)) @compileError("ePBS forks (gloas+) don't have blinded blocks");

    return struct {
        const Self = @This();

        inner: switch (bt) {
            .full => ForkTypes(f).SignedBeaconBlock.Type,
            .blinded => ForkTypes(f).SignedBlindedBeaconBlock.Type,
        },

        pub const block_type = bt;
        pub const fork_seq = f;

        pub inline fn message(self: *const Self) *const BeaconBlock(bt, f) {
            return @ptrCast(&self.inner.body);
        }
    };
}

pub fn BeaconBlock(comptime bt: BlockType, comptime f: ForkSeq) type {
    if (bt == .blinded and f.gte(.gloas)) @compileError("ePBS forks (gloas+) don't have blinded blocks");

    return struct {
        const Self = @This();

        inner: switch (bt) {
            .full => ForkTypes(f).BeaconBlock.Type,
            .blinded => ForkTypes(f).BlindedBeaconBlock.Type,
        },

        pub const block_type = bt;
        pub const fork_seq = f;

        pub inline fn slot(self: *const Self) u64 {
            return self.inner.slot;
        }

        pub inline fn proposerIndex(self: *const Self) u64 {
            return self.inner.proposer_index;
        }

        pub inline fn parentRoot(self: *const Self) *const [32]u8 {
            return &self.inner.parent_root;
        }

        pub inline fn body(self: *const Self) *const BeaconBlockBody(bt, f) {
            return @ptrCast(&self.inner.body);
        }
    };
}

pub fn BeaconBlockBody(comptime bt: BlockType, comptime f: ForkSeq) type {
    if (bt == .blinded and f.gte(.gloas)) @compileError("ePBS forks (gloas+) don't have blinded blocks");

    return struct {
        const Self = @This();

        inner: switch (bt) {
            .full => ForkTypes(f).BeaconBlockBody.Type,
            .blinded => ForkTypes(f).BlindedBeaconBlockBody.Type,
        },

        pub const block_type = bt;
        pub const fork_seq = f;

        pub inline fn hashTreeRoot(self: *const Self, allocator: std.mem.Allocator, out: *[32]u8) !void {
            if (bt == .full) {
                return ForkTypes(f).BeaconBlockBody.hashTreeRoot(allocator, &self.inner, out);
            }
            return ForkTypes(f).BlindedBeaconBlockBody.hashTreeRoot(allocator, &self.inner, out);
        }

        /// Root of a full body computed from the header of its execution payload. The header has the same
        /// root as the payload, so the blinded body has the same root as the full body. This avoids
        /// merkleizing the transactions again when the header is already known.
        ///
        /// `payload_header` must be the header of this body's execution payload.
        pub fn hashTreeRootFromPayloadHeader(
            self: *const Self,
            allocator: std.mem.Allocator,
            payload_header: *const ForkTypes(f).ExecutionPayloadHeader.Type,
            out: *[32]u8,
        ) !void {
            if (bt != .full or f.lt(.bellatrix) or f.gte(.gloas)) {
                @compileError("hashTreeRootFromPayloadHeader is only available for full blocks with an execution payload");
            }
            const Blinded = ForkTypes(f).BlindedBeaconBlockBody;
            var blinded: Blinded.Type = undefined;
            inline for (@typeInfo(Blinded.Type).@"struct".fields) |field| {
                if (comptime std.mem.eql(u8, field.name, "execution_payload_header")) {
                    blinded.execution_payload_header = payload_header.*;
                } else {
                    @field(blinded, field.name) = @field(self.inner, field.name);
                }
            }
            return Blinded.hashTreeRoot(allocator, &blinded, out);
        }

        pub inline fn eth1Data(self: *const Self) *const ForkTypes(f).Eth1Data.Type {
            return &self.inner.eth1_data;
        }

        pub inline fn executionPayload(self: *const Self) *const ExecutionPayload(f) {
            if (bt != .full) {
                @compileError("executionPayload is only available for full blocks");
            }
            if (f.gte(.gloas)) {
                @compileError("executionPayload is not available for ePBS forks (gloas+)");
            }

            return @ptrCast(&self.inner.execution_payload);
        }

        pub inline fn executionPayloadHeader(self: *const Self) *const ExecutionPayloadHeader(f) {
            if (bt != .blinded) {
                @compileError("executionPayloadHeader is only available for blinded blocks");
            }
            if (f.gte(.gloas)) {
                @compileError("executionPayloadHeader is not available for ePBS forks (gloas+)");
            }

            return @ptrCast(&self.inner.execution_payload_header);
        }

        pub inline fn randaoReveal(self: *const Self) *const [96]u8 {
            return &self.inner.randao_reveal;
        }

        pub inline fn syncAggregate(self: *const Self) *const ForkTypes(f).SyncAggregate.Type {
            if (f.lt(.altair)) {
                @compileError("syncAggregate is only available for altair and later forks");
            }
            return &self.inner.sync_aggregate;
        }

        pub inline fn blobKzgCommitments(self: *const Self) []const [48]u8 {
            if (f.lt(.deneb)) {
                @compileError("blobKzgCommitments is only available for deneb and later forks");
            }
            if (f.gte(.gloas)) {
                @compileError("blobKzgCommitments is not available for ePBS forks (gloas+)");
            }
            return self.inner.blob_kzg_commitments.items;
        }
    };
}
