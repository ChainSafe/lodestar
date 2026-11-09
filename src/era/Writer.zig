///! Writer is responsible for writing ERA files.
///! See https://github.com/eth-clients/e2store-format-specs/blob/main/formats/era.md
///!
///! Usage:
///! 1. Create a Writer with `Writer.open`
///! 2. For each group:
///!    a. Call `writeBlock` for each block in the group (skip for genesis era)
///!    b. Call `writeState` for the state at the end of the group
///! 3. Call `finish` to finalize the ERA file and rename it appropriately
const std = @import("std");
const c = @import("config");
const preset = @import("preset").preset;
const fork_types = @import("fork_types");
const snappy = @import("snappy").frame;
const e2s = @import("e2s.zig");
const era = @import("era.zig");

config: c.BeaconConfig,
path: []const u8,
file: std.Io.File,
io: std.Io,
era_number: u64,
state: WriterState,

const Writer = @This();

pub const WriterState = union(enum) {
    init_group: struct {
        era_number: u64,
        current_offset: u64,
    },
    write_group: struct {
        era_number: u64,
        current_offset: u64,
        block_offsets: std.ArrayList(u64),
        last_block_slot: u64,
    },
    finished_group: struct {
        era_number: u64,
        current_offset: u64,
        short_era_root: [8]u8,
    },
};

pub fn open(config: c.BeaconConfig, io: std.Io, path: []const u8, era_number: u64) !Writer {
    const file = try std.Io.Dir.createFile(.cwd(), io, path, .{});
    return .{
        .config = config,
        .path = path,
        .file = file,
        .io = io,
        .era_number = era_number,
        .state = .{
            .init_group = .{
                .era_number = era_number,
                .current_offset = 0,
            },
        },
    };
}

/// Close the writer and renames the ERA file.
/// Returns the path of the ERA file.
///
/// Caller takes ownership of the returned slice.
pub fn finish(self: *Writer, allocator: std.mem.Allocator, io: std.Io) ![]const u8 {
    if (self.state != .finished_group) {
        return error.NotFinished;
    }
    self.file.close(io);

    const new_base = try std.fmt.allocPrint(
        allocator,
        "{s}-{d:0>5}-{s}.era",
        .{ self.config.chain.CONFIG_NAME, self.era_number, self.state.finished_group.short_era_root },
    );
    defer allocator.free(new_base);

    const new_path = try std.fs.path.join(
        allocator,
        &[_][]const u8{ std.fs.path.dirname(self.path) orelse ".", new_base },
    );
    errdefer allocator.free(new_path);
    try std.Io.Dir.rename(.cwd(), self.path, .cwd(), new_path, io);

    return new_path;
}

pub fn writeVersion(self: *Writer, allocator: std.mem.Allocator) !void {
    if (self.state == .finished_group) {
        const prev_era_number = self.state.finished_group.era_number;
        const prev_offset = self.state.finished_group.current_offset;
        self.state = .{
            .init_group = .{
                .era_number = prev_era_number + 1,
                .current_offset = prev_offset,
            },
        };
    }
    if (self.state != .init_group) {
        return error.AlreadyInitialized;
    }
    try e2s.writeEntry(self.io, self.file, self.state.init_group.current_offset, .Version, &[0]u8{});

    // Move to writing blocks/state.
    const init_era_number = self.state.init_group.era_number;
    const init_offset = self.state.init_group.current_offset;
    const block_offsets = try std.ArrayList(u64).initCapacity(allocator, preset.SLOTS_PER_HISTORICAL_ROOT);
    const last_block_slot: u64 = if (init_era_number == 0)
        0
    else
        (try era.computeStartBlockSlotFromEraNumber(init_era_number)) - 1;
    self.state = .{
        .write_group = .{
            .era_number = init_era_number,
            .current_offset = init_offset + e2s.header_size,
            .block_offsets = block_offsets,
            .last_block_slot = last_block_slot,
        },
    };
}

pub fn writeCompressedState(self: *Writer, allocator: std.mem.Allocator, slot: u64, short_era_root: [8]u8, data: []const u8) !void {
    if (self.state == .init_group) {
        try self.writeVersion(allocator);
    }
    if (self.state != .write_group) {
        return error.NotWritingBlocks;
    }
    if (!era.isValidEraStateSlot(slot, self.state.write_group.era_number)) {
        return error.InvalidStateSlot;
    }

    // Pad block offsets up to the state slot (treated as empty slots)
    try self.state.write_group.block_offsets.appendNTimes(
        allocator,
        0,
        try std.math.sub(u64, slot, self.state.write_group.last_block_slot + 1),
    );

    const state_offset = self.state.write_group.current_offset;
    try e2s.writeEntry(self.io, self.file, self.state.write_group.current_offset, .CompressedBeaconState, data);
    self.state.write_group.current_offset += e2s.header_size + data.len;

    if (self.state.write_group.era_number > 0) {
        // Offsets values are relative to the start of the blocks index entry,
        // but they are initially relative to the start of the file,
        // so we need to adjust them.
        // Reuse offsets memory for this purpose.
        const offsets = std.mem.bytesAsSlice(i64, std.mem.sliceAsBytes(self.state.write_group.block_offsets.items));
        for (0..self.state.write_group.block_offsets.items.len) |i| {
            // Given the bounds of the era spec and network configurations, overflow is not feasible here.
            offsets[i] = @as(i64, @intCast(offsets[i])) - @as(i64, @intCast(self.state.write_group.current_offset));
        }
        const blocks_index: e2s.SlotIndex = .{
            .start_slot = try era.computeStartBlockSlotFromEraNumber(self.state.write_group.era_number),
            .offsets = offsets,
            .record_start = @intCast(self.state.write_group.current_offset),
        };
        const blocks_index_payload = try blocks_index.serialize(allocator);
        defer allocator.free(blocks_index_payload);

        try e2s.writeEntry(self.io, self.file, self.state.write_group.current_offset, .SlotIndex, blocks_index_payload);
        self.state.write_group.current_offset += e2s.header_size + blocks_index_payload.len;
    }
    // Given the bounds of the era spec and network configurations, overflow is not feasible here.
    var state_index_offsets = [_]i64{@as(i64, @intCast(state_offset)) - @as(i64, @intCast(self.state.write_group.current_offset))};
    const state_index: e2s.SlotIndex = .{
        .start_slot = slot,
        .offsets = &state_index_offsets,
        .record_start = @intCast(self.state.write_group.current_offset),
    };
    const state_index_payload = try state_index.serialize(allocator);
    defer allocator.free(state_index_payload);

    try e2s.writeEntry(self.io, self.file, self.state.write_group.current_offset, .SlotIndex, state_index_payload);
    self.state.write_group.current_offset += e2s.header_size + state_index_payload.len;
    self.state.write_group.last_block_slot = slot;

    self.state.write_group.block_offsets.deinit(allocator);
    const wg_era_number = self.state.write_group.era_number;
    const wg_current_offset = self.state.write_group.current_offset;
    self.state = .{
        .finished_group = .{
            .era_number = wg_era_number,
            .current_offset = wg_current_offset,
            .short_era_root = short_era_root,
        },
    };
}

pub fn writeSerializedState(self: *Writer, allocator: std.mem.Allocator, slot: u64, short_era_root: [8]u8, data: []const u8) !void {
    const compressed = try snappy.compress(allocator, data);
    defer allocator.free(compressed);
    try self.writeCompressedState(allocator, slot, short_era_root, compressed);
}

pub fn writeState(self: *Writer, allocator: std.mem.Allocator, state: fork_types.AnyBeaconState) !void {
    var s = state;
    const slot = try s.slot();
    const short_era_root = try era.getShortEraRoot(state);
    const serialized = try state.serialize(allocator);
    defer allocator.free(serialized);
    try self.writeSerializedState(allocator, slot, short_era_root, serialized);
}

pub fn writeCompressedBlock(self: *Writer, allocator: std.mem.Allocator, slot: u64, data: []const u8) !void {
    if (self.state == .init_group) {
        try self.writeVersion(allocator);
    }
    if (self.state != .write_group) {
        return error.NotWritingBlocks;
    }
    if (self.state.write_group.era_number == 0) {
        return error.GenesisEraCannotHaveBlocks;
    }
    if (!era.isValidEraBlockSlot(slot, self.state.write_group.era_number)) {
        return error.InvalidBlockSlot;
    }
    if (slot <= self.state.write_group.last_block_slot) {
        return error.NotAscendingBlockSlot;
    }

    // Pad block offsets up to the block slot (treated as empty slots)
    try self.state.write_group.block_offsets.appendNTimes(
        allocator,
        0,
        try std.math.sub(u64, slot, self.state.write_group.last_block_slot + 1),
    );

    const block_offset = self.state.write_group.current_offset;
    try e2s.writeEntry(self.io, self.file, block_offset, .CompressedSignedBeaconBlock, data);
    try self.state.write_group.block_offsets.append(allocator, block_offset);
    self.state.write_group.current_offset += e2s.header_size + data.len;
    self.state.write_group.last_block_slot = slot;
}

pub fn writeSerializedBlock(self: *Writer, allocator: std.mem.Allocator, slot: u64, data: []const u8) !void {
    const compressed = try snappy.compress(allocator, data);
    defer allocator.free(compressed);
    try self.writeCompressedBlock(allocator, slot, compressed);
}

pub fn writeBlock(self: *Writer, allocator: std.mem.Allocator, block: fork_types.AnySignedBeaconBlock) !void {
    const slot = block.beaconBlock().slot();
    const serialized = try block.serialize(allocator);
    defer allocator.free(serialized);
    try self.writeSerializedBlock(allocator, slot, serialized);
}
