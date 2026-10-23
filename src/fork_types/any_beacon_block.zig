const std = @import("std");

const ForkSeq = @import("config").ForkSeq;
const ct = @import("consensus_types");
const Slot = ct.primitive.Slot.Type;
const Deposit = ct.phase0.Deposit.Type;
const SignedVoluntaryExit = ct.phase0.SignedVoluntaryExit.Type;
const ValidatorIndex = ct.primitive.ValidatorIndex.Type;
const SignedBLSToExecutionChange = ct.capella.SignedBLSToExecutionChange.Type;
const DepositRequest = ct.electra.DepositRequest.Type;
const WithdrawalRequest = ct.electra.WithdrawalRequest.Type;
const ConsolidationRequest = ct.electra.ConsolidationRequest.Type;
const Root = ct.primitive.Root.Type;
const ProposerSlashing = ct.phase0.ProposerSlashing.Type;
const BlockType = @import("./block_type.zig").BlockType;
const AnyExecutionPayload = @import("./any_execution_payload.zig").AnyExecutionPayload;
const AnyExecutionPayloadHeader = @import("./any_execution_payload.zig").AnyExecutionPayloadHeader;
const AnyAttestations = @import("./any_attestation.zig").AnyAttestations;
const AnyAttesterSlashings = @import("./any_attester_slashing.zig").AnyAttesterSlashings;
const BeaconBlock = @import("./beacon_block.zig").BeaconBlock;
const BeaconBlockBody = @import("./beacon_block.zig").BeaconBlockBody;

fn deserializeSignedBlock(
    comptime SignedBlock: type,
    allocator: std.mem.Allocator,
    bytes: []const u8,
) !*SignedBlock.Type {
    const signed_block = try allocator.create(SignedBlock.Type);
    errdefer allocator.destroy(signed_block);

    signed_block.* = SignedBlock.default_value;
    errdefer SignedBlock.deinit(allocator, signed_block);

    try SignedBlock.deserializeFromBytes(allocator, bytes, signed_block);
    return signed_block;
}

pub const AnySignedBeaconBlock = union(enum) {
    phase0: *ct.phase0.SignedBeaconBlock.Type,
    altair: *ct.altair.SignedBeaconBlock.Type,
    full_bellatrix: *ct.bellatrix.SignedBeaconBlock.Type,
    blinded_bellatrix: *ct.bellatrix.SignedBlindedBeaconBlock.Type,
    full_capella: *ct.capella.SignedBeaconBlock.Type,
    blinded_capella: *ct.capella.SignedBlindedBeaconBlock.Type,
    full_deneb: *ct.deneb.SignedBeaconBlock.Type,
    blinded_deneb: *ct.deneb.SignedBlindedBeaconBlock.Type,
    full_electra: *ct.electra.SignedBeaconBlock.Type,
    blinded_electra: *ct.electra.SignedBlindedBeaconBlock.Type,
    full_fulu: *ct.fulu.SignedBeaconBlock.Type,
    blinded_fulu: *ct.fulu.SignedBlindedBeaconBlock.Type,
    full_gloas: *ct.gloas.SignedBeaconBlock.Type,
    full_heze: *ct.heze.SignedBeaconBlock.Type,

    pub fn deserialize(allocator: std.mem.Allocator, block_type: BlockType, fork_seq: ForkSeq, bytes: []const u8) !AnySignedBeaconBlock {
        switch (fork_seq) {
            .phase0 => {
                if (block_type != .full) return error.InvalidBlockTypeForFork;
                const signed_block = try deserializeSignedBlock(
                    ct.phase0.SignedBeaconBlock,
                    allocator,
                    bytes,
                );
                return .{ .phase0 = signed_block };
            },
            .altair => {
                if (block_type != .full) return error.InvalidBlockTypeForFork;
                const signed_block = try deserializeSignedBlock(
                    ct.altair.SignedBeaconBlock,
                    allocator,
                    bytes,
                );
                return .{ .altair = signed_block };
            },
            .bellatrix => {
                if (block_type == .full) {
                    const signed_block = try deserializeSignedBlock(
                        ct.bellatrix.SignedBeaconBlock,
                        allocator,
                        bytes,
                    );
                    return .{ .full_bellatrix = signed_block };
                } else {
                    const signed_block = try deserializeSignedBlock(
                        ct.bellatrix.SignedBlindedBeaconBlock,
                        allocator,
                        bytes,
                    );
                    return .{ .blinded_bellatrix = signed_block };
                }
            },
            .capella => {
                if (block_type == .full) {
                    const signed_block = try deserializeSignedBlock(
                        ct.capella.SignedBeaconBlock,
                        allocator,
                        bytes,
                    );
                    return .{ .full_capella = signed_block };
                } else {
                    const signed_block = try deserializeSignedBlock(
                        ct.capella.SignedBlindedBeaconBlock,
                        allocator,
                        bytes,
                    );
                    return .{ .blinded_capella = signed_block };
                }
            },
            .deneb => {
                if (block_type == .full) {
                    const signed_block = try deserializeSignedBlock(
                        ct.deneb.SignedBeaconBlock,
                        allocator,
                        bytes,
                    );
                    return .{ .full_deneb = signed_block };
                } else {
                    const signed_block = try deserializeSignedBlock(
                        ct.deneb.SignedBlindedBeaconBlock,
                        allocator,
                        bytes,
                    );
                    return .{ .blinded_deneb = signed_block };
                }
            },
            .electra => {
                if (block_type == .full) {
                    const signed_block = try deserializeSignedBlock(
                        ct.electra.SignedBeaconBlock,
                        allocator,
                        bytes,
                    );
                    return .{ .full_electra = signed_block };
                } else {
                    const signed_block = try deserializeSignedBlock(
                        ct.electra.SignedBlindedBeaconBlock,
                        allocator,
                        bytes,
                    );
                    return .{ .blinded_electra = signed_block };
                }
            },
            .fulu => {
                if (block_type == .full) {
                    const signed_block = try deserializeSignedBlock(
                        ct.fulu.SignedBeaconBlock,
                        allocator,
                        bytes,
                    );
                    return .{ .full_fulu = signed_block };
                } else {
                    const signed_block = try deserializeSignedBlock(
                        ct.fulu.SignedBlindedBeaconBlock,
                        allocator,
                        bytes,
                    );
                    return .{ .blinded_fulu = signed_block };
                }
            },
            .gloas => {
                if (block_type != .full) return error.InvalidBlockTypeForFork;
                const signed_block = try deserializeSignedBlock(
                    ct.gloas.SignedBeaconBlock,
                    allocator,
                    bytes,
                );
                return .{ .full_gloas = signed_block };
            },
            .heze => {
                if (block_type != .full) return error.InvalidBlockTypeForFork;
                const signed_block = try deserializeSignedBlock(
                    ct.heze.SignedBeaconBlock,
                    allocator,
                    bytes,
                );
                return .{ .full_heze = signed_block };
            },
        }
    }

    pub fn deinit(self: AnySignedBeaconBlock, allocator: std.mem.Allocator) void {
        switch (self) {
            .phase0 => |signed_block| {
                ct.phase0.SignedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
            .altair => |signed_block| {
                ct.altair.SignedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
            .full_bellatrix => |signed_block| {
                ct.bellatrix.SignedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
            .blinded_bellatrix => |signed_block| {
                ct.bellatrix.SignedBlindedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
            .full_capella => |signed_block| {
                ct.capella.SignedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
            .blinded_capella => |signed_block| {
                ct.capella.SignedBlindedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
            .full_deneb => |signed_block| {
                ct.deneb.SignedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
            .blinded_deneb => |signed_block| {
                ct.deneb.SignedBlindedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
            .full_electra => |signed_block| {
                ct.electra.SignedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
            .blinded_electra => |signed_block| {
                ct.electra.SignedBlindedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
            .full_fulu => |signed_block| {
                ct.fulu.SignedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
            .blinded_fulu => |signed_block| {
                ct.fulu.SignedBlindedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
            .full_gloas => |signed_block| {
                ct.gloas.SignedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
            .full_heze => |signed_block| {
                ct.heze.SignedBeaconBlock.deinit(allocator, signed_block);
                allocator.destroy(signed_block);
            },
        }
    }

    pub fn serialize(self: AnySignedBeaconBlock, allocator: std.mem.Allocator) ![]u8 {
        switch (self) {
            .phase0 => |signed_block| {
                const out = try allocator.alloc(u8, ct.phase0.SignedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.phase0.SignedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
            .altair => |signed_block| {
                const out = try allocator.alloc(u8, ct.altair.SignedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.altair.SignedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
            .full_bellatrix => |signed_block| {
                const out = try allocator.alloc(u8, ct.bellatrix.SignedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.bellatrix.SignedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
            .blinded_bellatrix => |signed_block| {
                const out = try allocator.alloc(u8, ct.bellatrix.SignedBlindedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.bellatrix.SignedBlindedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
            .full_capella => |signed_block| {
                const out = try allocator.alloc(u8, ct.capella.SignedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.capella.SignedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
            .blinded_capella => |signed_block| {
                const out = try allocator.alloc(u8, ct.capella.SignedBlindedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.capella.SignedBlindedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
            .full_deneb => |signed_block| {
                const out = try allocator.alloc(u8, ct.deneb.SignedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.deneb.SignedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
            .blinded_deneb => |signed_block| {
                const out = try allocator.alloc(u8, ct.deneb.SignedBlindedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.deneb.SignedBlindedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
            .full_electra => |signed_block| {
                const out = try allocator.alloc(u8, ct.electra.SignedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.electra.SignedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
            .blinded_electra => |signed_block| {
                const out = try allocator.alloc(u8, ct.electra.SignedBlindedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.electra.SignedBlindedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
            .full_fulu => |signed_block| {
                const out = try allocator.alloc(u8, ct.fulu.SignedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.fulu.SignedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
            .blinded_fulu => |signed_block| {
                const out = try allocator.alloc(u8, ct.fulu.SignedBlindedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.fulu.SignedBlindedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
            .full_gloas => |signed_block| {
                const out = try allocator.alloc(u8, ct.gloas.SignedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.gloas.SignedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
            .full_heze => |signed_block| {
                const out = try allocator.alloc(u8, ct.heze.SignedBeaconBlock.serializedSize(signed_block));
                errdefer allocator.free(out);
                _ = ct.heze.SignedBeaconBlock.serializeIntoBytes(signed_block, out);
                return out;
            },
        }
    }

    pub fn blockType(self: *const AnySignedBeaconBlock) BlockType {
        return switch (self.*) {
            .phase0, .altair, .full_bellatrix, .full_capella, .full_deneb, .full_electra, .full_fulu, .full_gloas, .full_heze => .full,
            .blinded_bellatrix, .blinded_capella, .blinded_deneb, .blinded_electra, .blinded_fulu => .blinded,
        };
    }

    pub fn forkSeq(self: *const AnySignedBeaconBlock) ForkSeq {
        return switch (self.*) {
            .phase0 => .phase0,
            .altair => .altair,
            .full_bellatrix, .blinded_bellatrix => .bellatrix,
            .full_capella, .blinded_capella => .capella,
            .full_deneb, .blinded_deneb => .deneb,
            .full_electra, .blinded_electra => .electra,
            .full_fulu, .blinded_fulu => .fulu,
            .full_gloas => .gloas,
            .full_heze => .heze,
        };
    }

    pub fn beaconBlock(self: *const AnySignedBeaconBlock) AnyBeaconBlock {
        return switch (std.meta.activeTag(self.*)) {
            inline else => |t| {
                return @unionInit(
                    AnyBeaconBlock,
                    @tagName(t),
                    &@field(self, @tagName(t)).message,
                );
            },
        };
    }

    pub fn signature(self: *const AnySignedBeaconBlock) *const ct.primitive.BLSSignature.Type {
        return switch (self.*) {
            inline else => |block| &block.signature,
        };
    }
};

pub const AnyBeaconBlock = union(enum) {
    phase0: *ct.phase0.BeaconBlock.Type,
    altair: *ct.altair.BeaconBlock.Type,
    full_bellatrix: *ct.bellatrix.BeaconBlock.Type,
    blinded_bellatrix: *ct.bellatrix.BlindedBeaconBlock.Type,
    full_capella: *ct.capella.BeaconBlock.Type,
    blinded_capella: *ct.capella.BlindedBeaconBlock.Type,
    full_deneb: *ct.deneb.BeaconBlock.Type,
    blinded_deneb: *ct.deneb.BlindedBeaconBlock.Type,
    full_electra: *ct.electra.BeaconBlock.Type,
    blinded_electra: *ct.electra.BlindedBeaconBlock.Type,
    full_fulu: *ct.fulu.BeaconBlock.Type,
    blinded_fulu: *ct.fulu.BlindedBeaconBlock.Type,
    full_gloas: *ct.gloas.BeaconBlock.Type,
    full_heze: *ct.heze.BeaconBlock.Type,

    pub fn blockType(self: *const AnyBeaconBlock) BlockType {
        return switch (self.*) {
            .phase0, .altair, .full_bellatrix, .full_capella, .full_deneb, .full_electra, .full_fulu, .full_gloas, .full_heze => .full,
            .blinded_bellatrix, .blinded_capella, .blinded_deneb, .blinded_electra, .blinded_fulu => .blinded,
        };
    }

    pub fn forkSeq(self: *const AnyBeaconBlock) ForkSeq {
        return switch (self.*) {
            .phase0 => .phase0,
            .altair => .altair,
            .full_bellatrix, .blinded_bellatrix => .bellatrix,
            .full_capella, .blinded_capella => .capella,
            .full_deneb, .blinded_deneb => .deneb,
            .full_electra, .blinded_electra => .electra,
            .full_fulu, .blinded_fulu => .fulu,
            .full_gloas => .gloas,
            .full_heze => .heze,
        };
    }

    pub fn castToFork(
        self: *const AnyBeaconBlock,
        comptime block_type: BlockType,
        comptime fork: ForkSeq,
    ) *const BeaconBlock(block_type, fork) {
        return switch (fork) {
            .phase0 => if (block_type == .full)
                @ptrCast(self.phase0)
            else
                @compileError("phase0 doesn't have blinded blocks"),
            .altair => if (block_type == .full)
                @ptrCast(self.altair)
            else
                @compileError("altair doesn't have blinded blocks"),
            .bellatrix => if (block_type == .full)
                @ptrCast(self.full_bellatrix)
            else
                @ptrCast(self.blinded_bellatrix),
            .capella => if (block_type == .full)
                @ptrCast(self.full_capella)
            else
                @ptrCast(self.blinded_capella),
            .deneb => if (block_type == .full)
                @ptrCast(self.full_deneb)
            else
                @ptrCast(self.blinded_deneb),
            .electra => if (block_type == .full)
                @ptrCast(self.full_electra)
            else
                @ptrCast(self.blinded_electra),
            .fulu => if (block_type == .full)
                @ptrCast(self.full_fulu)
            else
                @ptrCast(self.blinded_fulu),
            .gloas => if (block_type == .full)
                @ptrCast(self.full_gloas)
            else
                @compileError("gloas doesn't have blinded blocks (ePBS)"),
            .heze => if (block_type == .full)
                @ptrCast(self.full_heze)
            else
                @compileError("heze doesn't have blinded blocks (ePBS)"),
        };
    }

    pub fn hashTreeRoot(self: *const AnyBeaconBlock, allocator: std.mem.Allocator, out: *[32]u8) !void {
        switch (self.*) {
            .phase0 => |block| try ct.phase0.BeaconBlock.hashTreeRoot(allocator, block, out),
            .altair => |block| try ct.altair.BeaconBlock.hashTreeRoot(allocator, block, out),
            .full_bellatrix => |block| try ct.bellatrix.BeaconBlock.hashTreeRoot(allocator, block, out),
            .blinded_bellatrix => |block| try ct.bellatrix.BlindedBeaconBlock.hashTreeRoot(allocator, block, out),
            .full_capella => |block| try ct.capella.BeaconBlock.hashTreeRoot(allocator, block, out),
            .blinded_capella => |block| try ct.capella.BlindedBeaconBlock.hashTreeRoot(allocator, block, out),
            .full_deneb => |block| try ct.deneb.BeaconBlock.hashTreeRoot(allocator, block, out),
            .blinded_deneb => |block| try ct.deneb.BlindedBeaconBlock.hashTreeRoot(allocator, block, out),
            .full_electra => |block| try ct.electra.BeaconBlock.hashTreeRoot(allocator, block, out),
            .blinded_electra => |block| try ct.electra.BlindedBeaconBlock.hashTreeRoot(allocator, block, out),
            .full_fulu => |block| try ct.fulu.BeaconBlock.hashTreeRoot(allocator, block, out),
            .blinded_fulu => |block| try ct.fulu.BlindedBeaconBlock.hashTreeRoot(allocator, block, out),
            .full_gloas => |block| try ct.gloas.BeaconBlock.hashTreeRoot(allocator, block, out),
            .full_heze => |block| try ct.heze.BeaconBlock.hashTreeRoot(allocator, block, out),
        }
    }

    pub fn slot(self: *const AnyBeaconBlock) Slot {
        return switch (self.*) {
            inline else => |block| block.slot,
        };
    }

    pub fn proposerIndex(self: *const AnyBeaconBlock) ValidatorIndex {
        return switch (self.*) {
            inline else => |block| block.proposer_index,
        };
    }

    pub fn parentRoot(self: *const AnyBeaconBlock) *const Root {
        return switch (self.*) {
            inline else => |block| &block.parent_root,
        };
    }

    pub fn stateRoot(self: *const AnyBeaconBlock) *const Root {
        return switch (self.*) {
            inline else => |block| &block.state_root,
        };
    }

    pub fn beaconBlockBody(self: *const AnyBeaconBlock) AnyBeaconBlockBody {
        return switch (std.meta.activeTag(self.*)) {
            inline else => |t| {
                return @unionInit(
                    AnyBeaconBlockBody,
                    @tagName(t),
                    &@field(self, @tagName(t)).body,
                );
            },
        };
    }
};

pub const AnyBeaconBlockBody = union(enum) {
    phase0: *ct.phase0.BeaconBlockBody.Type,
    altair: *ct.altair.BeaconBlockBody.Type,
    full_bellatrix: *ct.bellatrix.BeaconBlockBody.Type,
    blinded_bellatrix: *ct.bellatrix.BlindedBeaconBlockBody.Type,
    full_capella: *ct.capella.BeaconBlockBody.Type,
    blinded_capella: *ct.capella.BlindedBeaconBlockBody.Type,
    full_deneb: *ct.deneb.BeaconBlockBody.Type,
    blinded_deneb: *ct.deneb.BlindedBeaconBlockBody.Type,
    full_electra: *ct.electra.BeaconBlockBody.Type,
    blinded_electra: *ct.electra.BlindedBeaconBlockBody.Type,
    full_fulu: *ct.fulu.BeaconBlockBody.Type,
    blinded_fulu: *ct.fulu.BlindedBeaconBlockBody.Type,
    full_gloas: *ct.gloas.BeaconBlockBody.Type,
    full_heze: *ct.heze.BeaconBlockBody.Type,

    pub fn blockType(self: *const AnyBeaconBlockBody) BlockType {
        return switch (self.*) {
            .phase0, .altair, .full_bellatrix, .full_capella, .full_deneb, .full_electra, .full_fulu, .full_gloas, .full_heze => .full,
            .blinded_bellatrix, .blinded_capella, .blinded_deneb, .blinded_electra, .blinded_fulu => .blinded,
        };
    }

    pub fn forkSeq(self: *const AnyBeaconBlockBody) ForkSeq {
        return switch (self.*) {
            .phase0 => .phase0,
            .altair => .altair,
            .full_bellatrix, .blinded_bellatrix => .bellatrix,
            .full_capella, .blinded_capella => .capella,
            .full_deneb, .blinded_deneb => .deneb,
            .full_electra, .blinded_electra => .electra,
            .full_fulu, .blinded_fulu => .fulu,
            .full_gloas => .gloas,
            .full_heze => .heze,
        };
    }

    pub fn castToFork(
        self: *const AnyBeaconBlockBody,
        comptime block_type: BlockType,
        comptime fork: ForkSeq,
    ) *const BeaconBlockBody(block_type, fork) {
        return switch (fork) {
            .phase0 => @ptrCast(self.phase0),
            .altair => @ptrCast(self.altair),
            .bellatrix => if (block_type == .full)
                @ptrCast(self.full_bellatrix)
            else
                @ptrCast(self.blinded_bellatrix),
            .capella => if (block_type == .full)
                @ptrCast(self.full_capella)
            else
                @ptrCast(self.blinded_capella),
            .deneb => if (block_type == .full)
                @ptrCast(self.full_deneb)
            else
                @ptrCast(self.blinded_deneb),
            .electra => if (block_type == .full)
                @ptrCast(self.full_electra)
            else
                @ptrCast(self.blinded_electra),
            .fulu => if (block_type == .full)
                @ptrCast(self.full_fulu)
            else
                @ptrCast(self.blinded_fulu),
            .gloas => if (block_type == .full)
                @ptrCast(self.full_gloas)
            else
                @compileError("gloas doesn't have blinded blocks (ePBS)"),
            .heze => if (block_type == .full)
                @ptrCast(self.full_heze)
            else
                @compileError("heze doesn't have blinded blocks (ePBS)"),
        };
    }

    pub fn hashTreeRoot(self: *const AnyBeaconBlockBody, allocator: std.mem.Allocator, out: *[32]u8) !void {
        return switch (self.*) {
            .phase0 => |body| try ct.phase0.BeaconBlockBody.hashTreeRoot(allocator, body, out),
            .altair => |body| try ct.altair.BeaconBlockBody.hashTreeRoot(allocator, body, out),
            .full_bellatrix => |body| try ct.bellatrix.BeaconBlockBody.hashTreeRoot(allocator, body, out),
            .blinded_bellatrix => |body| try ct.bellatrix.BlindedBeaconBlockBody.hashTreeRoot(allocator, body, out),
            .full_capella => |body| try ct.capella.BeaconBlockBody.hashTreeRoot(allocator, body, out),
            .blinded_capella => |body| try ct.capella.BlindedBeaconBlockBody.hashTreeRoot(allocator, body, out),
            .full_deneb => |body| try ct.deneb.BeaconBlockBody.hashTreeRoot(allocator, body, out),
            .blinded_deneb => |body| try ct.deneb.BlindedBeaconBlockBody.hashTreeRoot(allocator, body, out),
            .full_electra => |body| try ct.electra.BeaconBlockBody.hashTreeRoot(allocator, body, out),
            .blinded_electra => |body| try ct.electra.BlindedBeaconBlockBody.hashTreeRoot(allocator, body, out),
            .full_fulu => |body| try ct.fulu.BeaconBlockBody.hashTreeRoot(allocator, body, out),
            .blinded_fulu => |body| try ct.fulu.BlindedBeaconBlockBody.hashTreeRoot(allocator, body, out),
            .full_gloas => |body| try ct.gloas.BeaconBlockBody.hashTreeRoot(allocator, body, out),
            .full_heze => |body| try ct.heze.BeaconBlockBody.hashTreeRoot(allocator, body, out),
        };
    }

    pub fn isExecutionType(self: *const AnyBeaconBlockBody) bool {
        return switch (self.*) {
            .phase0 => false,
            .altair => false,
            else => true,
        };
    }

    // phase0 fields
    pub fn randaoReveal(self: *const AnyBeaconBlockBody) *const ct.primitive.BLSSignature.Type {
        return switch (self.*) {
            inline else => |body| &body.randao_reveal,
        };
    }

    pub fn eth1Data(self: *const AnyBeaconBlockBody) !*const ct.phase0.Eth1Data.Type {
        return switch (self.*) {
            .full_heze => error.InvalidAtFork,
            inline else => |body| &body.eth1_data,
        };
    }

    pub fn graffiti(self: *const AnyBeaconBlockBody) *const ct.primitive.Bytes32.Type {
        return switch (self.*) {
            inline else => |body| &body.graffiti,
        };
    }

    pub fn proposerSlashings(self: *const AnyBeaconBlockBody) []ProposerSlashing {
        return switch (self.*) {
            inline else => |body| body.proposer_slashings.items,
        };
    }

    pub fn attesterSlashings(self: *const AnyBeaconBlockBody) AnyAttesterSlashings {
        return switch (self.*) {
            inline .phase0, .altair, .full_bellatrix, .blinded_bellatrix, .full_capella, .blinded_capella, .full_deneb, .blinded_deneb => |body| .{ .phase0 = body.attester_slashings },
            inline .full_electra, .blinded_electra, .full_fulu, .blinded_fulu => |body| .{ .electra = body.attester_slashings },
            inline .full_gloas, .full_heze => |body| .{ .gloas = body.attester_slashings },
        };
    }

    pub fn attestations(self: *const AnyBeaconBlockBody) AnyAttestations {
        return switch (self.*) {
            inline .phase0, .altair, .full_bellatrix, .blinded_bellatrix, .full_capella, .blinded_capella, .full_deneb, .blinded_deneb => |body| .{ .phase0 = body.attestations },
            inline .full_electra, .blinded_electra, .full_fulu, .blinded_fulu => |body| .{ .electra = body.attestations },
            inline .full_gloas, .full_heze => |body| .{ .gloas = body.attestations },
        };
    }

    pub fn deposits(self: *const AnyBeaconBlockBody) ![]Deposit {
        return switch (self.*) {
            .full_heze => error.InvalidAtFork,
            inline else => |body| body.deposits.items,
        };
    }

    pub fn voluntaryExits(self: *const AnyBeaconBlockBody) []SignedVoluntaryExit {
        return switch (self.*) {
            inline else => |body| body.voluntary_exits.items,
        };
    }

    // altair fields
    pub fn syncAggregate(self: *const AnyBeaconBlockBody) !*const ct.altair.SyncAggregate.Type {
        return switch (self.*) {
            .phase0 => return error.InvalidFork,
            inline else => |body| &body.sync_aggregate,
        };
    }

    // bellatrix fields
    pub fn executionPayload(self: *const AnyBeaconBlockBody) !AnyExecutionPayload {
        return switch (self.*) {
            .phase0, .altair => return error.InvalidFork,
            .full_bellatrix => |body| .{ .bellatrix = body.execution_payload },
            .full_capella => |body| .{ .capella = body.execution_payload },
            .full_deneb => |body| .{ .deneb = body.execution_payload },
            .full_electra => |body| .{ .deneb = body.execution_payload },
            .full_fulu => |body| .{ .deneb = body.execution_payload },
            else => return error.InvalidBlockType,
        };
    }

    pub fn executionPayloadHeader(self: *const AnyBeaconBlockBody) !AnyExecutionPayloadHeader {
        return switch (self.*) {
            .phase0, .altair => return error.InvalidFork,
            .blinded_bellatrix => |body| .{ .bellatrix = body.execution_payload_header },
            .blinded_capella => |body| .{ .capella = body.execution_payload_header },
            .blinded_deneb => |body| .{ .deneb = body.execution_payload_header },
            .blinded_electra => |body| .{ .deneb = body.execution_payload_header },
            .blinded_fulu => |body| .{ .deneb = body.execution_payload_header },
            else => return error.InvalidBlockType,
        };
    }

    // capella fields
    pub fn blsToExecutionChanges(self: *const AnyBeaconBlockBody) ![]SignedBLSToExecutionChange {
        return switch (self.*) {
            .phase0, .altair, .full_bellatrix, .blinded_bellatrix => error.InvalidFork,
            inline else => |body| body.bls_to_execution_changes.items,
        };
    }

    // deneb fields
    // Gloas (ePBS): blob_kzg_commitments moved to ExecutionPayloadBid
    pub fn blobKzgCommitments(self: *const AnyBeaconBlockBody) !*const ct.deneb.BlobKzgCommitments.Type {
        return switch (self.*) {
            .phase0, .altair, .full_bellatrix, .blinded_bellatrix, .full_capella, .blinded_capella, .full_gloas, .full_heze => error.InvalidFork,
            inline else => |body| &body.blob_kzg_commitments,
        };
    }

    // electra fields
    // Gloas (ePBS): execution_requests moved to ExecutionPayloadEnvelope
    pub fn executionRequests(self: *const AnyBeaconBlockBody) !*const ct.electra.ExecutionRequests.Type {
        return switch (self.*) {
            .phase0, .altair, .full_bellatrix, .blinded_bellatrix, .full_capella, .blinded_capella, .full_deneb, .blinded_deneb, .full_gloas, .full_heze => error.InvalidFork,
            inline else => |body| &body.execution_requests,
        };
    }

    pub fn depositRequests(self: *const AnyBeaconBlockBody) ![]DepositRequest {
        return switch (self.*) {
            .phase0, .altair, .full_bellatrix, .blinded_bellatrix, .full_capella, .blinded_capella, .full_deneb, .blinded_deneb, .full_gloas, .full_heze => error.InvalidFork,
            inline else => |body| body.execution_requests.deposits.items,
        };
    }

    pub fn withdrawalRequests(self: *const AnyBeaconBlockBody) ![]WithdrawalRequest {
        return switch (self.*) {
            .phase0, .altair, .full_bellatrix, .blinded_bellatrix, .full_capella, .blinded_capella, .full_deneb, .blinded_deneb, .full_gloas, .full_heze => error.InvalidFork,
            inline else => |body| body.execution_requests.withdrawals.items,
        };
    }

    pub fn consolidationRequests(self: *const AnyBeaconBlockBody) ![]ConsolidationRequest {
        return switch (self.*) {
            .phase0, .altair, .full_bellatrix, .blinded_bellatrix, .full_capella, .blinded_capella, .full_deneb, .blinded_deneb, .full_gloas, .full_heze => error.InvalidFork,
            inline else => |body| body.execution_requests.consolidations.items,
        };
    }

    // gloas fields (ePBS)
    pub fn signedExecutionPayloadBidBlockHash(self: *const AnyBeaconBlockBody) !*const [32]u8 {
        return switch (self.*) {
            inline .full_gloas, .full_heze => |body| &body.signed_execution_payload_bid.message.block_hash,
            else => error.InvalidFork,
        };
    }

    pub fn signedExecutionPayloadBidParentBlockHash(self: *const AnyBeaconBlockBody) !*const [32]u8 {
        return switch (self.*) {
            inline .full_gloas, .full_heze => |body| &body.signed_execution_payload_bid.message.parent_block_hash,
            else => error.InvalidFork,
        };
    }
};

test {
    _ = @import("any_beacon_block_test.zig");
}
