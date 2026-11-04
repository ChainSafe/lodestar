///! Reader is responsible for reading and validating ERA files.
///! See https://github.com/eth-clients/e2store-format-specs/blob/main/formats/era.md
const std = @import("std");
const c = @import("config");
const preset = @import("preset").preset;
const Node = @import("persistent_merkle_tree").Node;
const fork_types = @import("fork_types");
const snappy = @import("snappy").frame;
const e2s = @import("e2s.zig");
const era = @import("era.zig");

config: c.BeaconConfig,
/// The file being read
file: std.Io.File,
/// IO context for file operations
io: std.Io,
/// The era number retrieved from the file name
era_number: u64,
/// The short era root retrieved from the file name
short_era_root: [8]u8,
/// An array of state and block indices, one per group
group_indices: []era.GroupIndex,
/// Persistent merkle tree pool used by TreeViews (must outlive returned views)
pool: *Node.Pool,

const Reader = @This();

pub fn open(allocator: std.mem.Allocator, io: std.Io, config: c.BeaconConfig, path: []const u8) !Reader {
    const file = try std.Io.Dir.openFile(.cwd(), io, path, .{});
    errdefer file.close(io);
    const era_file_name = try era.EraFileName.parse(path);
    const group_indices = try era.readAllGroupIndices(allocator, io, file);
    errdefer {
        for (group_indices) |group_index| {
            allocator.free(group_index.state_index.offsets);
            if (group_index.blocks_index) |bi| {
                allocator.free(bi.offsets);
            }
        }
        allocator.free(group_indices);
    }

    const pool = try allocator.create(Node.Pool);
    errdefer allocator.destroy(pool);
    pool.* = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 10_000_000,
    });
    errdefer pool.deinit();

    return .{
        .config = config,
        .file = file,
        .io = io,
        .era_number = era_file_name.era_number,
        .short_era_root = era_file_name.short_era_root,
        .group_indices = group_indices,
        .pool = pool,
    };
}

pub fn close(self: *Reader, allocator: std.mem.Allocator) void {
    self.file.close(self.io);
    for (self.group_indices) |group_index| {
        allocator.free(group_index.state_index.offsets);
        if (group_index.blocks_index) |bi| {
            allocator.free(bi.offsets);
        }
    }
    allocator.free(self.group_indices);

    self.pool.deinit();
    allocator.destroy(self.pool);

    self.* = undefined;
}

pub fn readCompressedState(self: Reader, allocator: std.mem.Allocator, era_number: ?u64) ![]const u8 {
    const state_era_number = era_number orelse self.era_number;
    const group_index = try std.math.sub(u64, state_era_number, self.era_number);
    if (group_index >= self.group_indices.len) {
        return error.InvalidEraNumber;
    }
    const index = self.group_indices[group_index];
    const offset: u64 = @intCast(try std.math.add(i64, @intCast(index.state_index.record_start), index.state_index.offsets[0]));
    const entry = try e2s.readEntry(allocator, self.io, self.file, offset);
    errdefer allocator.free(entry.data);
    if (entry.entry_type != .CompressedBeaconState) {
        return error.InvalidE2SHeader;
    }
    return entry.data;
}

pub fn readSerializedState(self: Reader, allocator: std.mem.Allocator, era_number: ?u64) ![]const u8 {
    const compressed = try self.readCompressedState(allocator, era_number);
    defer allocator.free(compressed);

    return try snappy.uncompress(allocator, compressed) orelse error.InvalidE2SHeader;
}

pub fn readState(self: Reader, allocator: std.mem.Allocator, era_number: ?u64) !fork_types.AnyBeaconState {
    const serialized = try self.readSerializedState(allocator, era_number);
    defer allocator.free(serialized);

    const state_slot = fork_types.readSlotFromAnyBeaconStateBytes(serialized);
    const state_fork = self.config.forkSeq(state_slot);

    return try fork_types.AnyBeaconState.deserialize(allocator, self.pool, state_fork, serialized);
}

pub fn readCompressedBlock(self: Reader, allocator: std.mem.Allocator, slot: u64) !?[]const u8 {
    const slot_era = era.computeEraNumberFromBlockSlot(slot);
    const group_index = try std.math.sub(u64, slot_era, self.era_number);
    if (group_index >= self.group_indices.len) {
        return error.InvalidEraNumber;
    }
    const index = self.group_indices[group_index];
    const blocks_index = index.blocks_index orelse return error.NoBlockIndex;

    // Calculate offset within the index
    const slot_offset = try std.math.sub(u64, slot, blocks_index.start_slot);
    const offset: u64 = @intCast(try std.math.add(i64, @intCast(blocks_index.record_start), blocks_index.offsets[slot_offset]));
    if (offset == 0) {
        return null; // Empty slot
    }
    const entry = try e2s.readEntry(allocator, self.io, self.file, offset);
    errdefer allocator.free(entry.data);
    if (entry.entry_type != .CompressedSignedBeaconBlock) {
        return error.InvalidE2SHeader;
    }
    return entry.data;
}

pub fn readSerializedBlock(self: Reader, allocator: std.mem.Allocator, slot: u64) !?[]const u8 {
    const compressed = try self.readCompressedBlock(allocator, slot) orelse return null;
    defer allocator.free(compressed);

    return try snappy.uncompress(allocator, compressed) orelse error.InvalidE2SHeader;
}

pub fn readBlock(self: Reader, allocator: std.mem.Allocator, slot: u64) !?fork_types.AnySignedBeaconBlock {
    const serialized = try self.readSerializedBlock(allocator, slot) orelse return null;
    defer allocator.free(serialized);

    const fork_seq = self.config.forkSeq(slot);

    return try fork_types.AnySignedBeaconBlock.deserialize(allocator, .full, fork_seq, serialized);
}

/// Validate the era file.
/// - e2s format correctness
/// - era range correctness
/// - network correctness for state and blocks
/// - TODO block root and signature matches
pub fn validate(self: Reader, allocator: std.mem.Allocator) !void {
    for (self.group_indices, 0..) |index, group_index| {
        const era_number = self.era_number + group_index;

        // validate version entry
        const start: i64 = if (index.blocks_index) |bi|
            @as(i64, @intCast(bi.record_start)) + bi.offsets[0] - e2s.header_size
        else
            @as(i64, @intCast(index.state_index.record_start)) + index.state_index.offsets[0] - e2s.header_size;
        if (start < 0) {
            return error.InvalidGroupStartIndex;
        }
        try e2s.readVersion(self.io, self.file, @intCast(start));

        // Genesis era cannot have a block index
        if (era_number == 0 and index.blocks_index != null) {
            return error.GenesisEraHasBlockIndex;
        }

        // validate state
        // the state is loadable and consistent with the given config
        var state = try self.readState(allocator, era_number);
        defer state.deinit();

        if (!std.mem.eql(u8, &self.config.genesis_validator_root, try state.genesisValidatorsRoot())) {
            return error.GenesisValidatorRootMismatch;
        }

        // validate blocks
        if (era_number > 0) {
            if (index.blocks_index == null) {
                return error.MissingBlockIndex;
            }

            const start_slot = index.blocks_index.?.start_slot;
            const end_slot = start_slot + index.blocks_index.?.offsets.len;

            if (start_slot % preset.SLOTS_PER_HISTORICAL_ROOT != 0) {
                return error.InvalidBlockIndex;
            }

            if (end_slot != start_slot + preset.SLOTS_PER_HISTORICAL_ROOT) {
                return error.InvalidBlockIndex;
            }

            var blockRoots = try state.blockRoots();
            for (start_slot..end_slot) |slot| {
                const block = try self.readBlock(allocator, slot) orelse {
                    if (slot == start_slot) {
                        // first slot in the era can't be easily validated
                        continue;
                    }
                    var prev_root: [32]u8 = undefined;
                    var curr_root: [32]u8 = undefined;
                    var prev_view = try blockRoots.get(@intCast((slot - 1) % preset.SLOTS_PER_HISTORICAL_ROOT));
                    try prev_view.toValue(allocator, &prev_root);
                    var curr_view = try blockRoots.get(@intCast(slot % preset.SLOTS_PER_HISTORICAL_ROOT));
                    try curr_view.toValue(allocator, &curr_root);

                    if (std.mem.eql(u8, &prev_root, &curr_root)) {
                        continue;
                    }
                    return error.MissingBlock;
                };
                defer block.deinit(allocator);

                var block_root: [32]u8 = undefined;
                try block.beaconBlock().hashTreeRoot(allocator, &block_root);

                var expected_root: [32]u8 = undefined;
                var expected_view = try blockRoots.get(@intCast(slot % preset.SLOTS_PER_HISTORICAL_ROOT));
                try expected_view.toValue(allocator, &expected_root);

                if (!std.mem.eql(u8, &expected_root, &block_root)) {
                    return error.BlockRootMismatch;
                }
            }
        }
    }
}
