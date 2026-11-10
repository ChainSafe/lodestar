const std = @import("std");
const preset = @import("preset").preset;
const fork_types = @import("fork_types");
const e2s = @import("e2s.zig");

/// Parsed components of an .era file name.
/// Format: <config-name>-<era-number>-<short-era-root>.era
pub const EraFileName = struct {
    config_name: []const u8,
    era_number: u64,
    short_era_root: [8]u8,

    pub fn parse(path: []const u8) (error{InvalidEraFileName} || std.fmt.ParseIntError)!EraFileName {
        if (!std.mem.endsWith(u8, path, ".era")) {
            return error.InvalidEraFileName;
        }
        var it = std.mem.splitScalar(u8, std.fs.path.stem(path), '-');
        const config_name = it.next() orelse return error.InvalidEraFileName;
        const era_number = try std.fmt.parseUnsigned(u64, it.next() orelse return error.InvalidEraFileName, 10);
        var short_era_root: [8]u8 = undefined;
        const maybe_short_era_root = it.next() orelse return error.InvalidEraFileName;
        if (maybe_short_era_root.len != 8) {
            return error.InvalidEraFileName;
        }
        @memcpy(&short_era_root, maybe_short_era_root);
        return .{
            .config_name = config_name,
            .era_number = era_number,
            .short_era_root = short_era_root,
        };
    }
};

pub const GroupIndex = struct {
    state_index: e2s.SlotIndex,
    blocks_index: ?e2s.SlotIndex,

    pub fn deinit(self: GroupIndex, allocator: std.mem.Allocator) void {
        self.state_index.deinit(allocator);
        if (self.blocks_index) |bi| {
            bi.deinit(allocator);
        }
    }
};

/// Read state and block SlotIndex entries from an era file and validate alignment.
///
/// Ownership of the returned GroupIndex is transferred to the caller.
pub fn readGroupIndex(allocator: std.mem.Allocator, io: std.Io, file: std.Io.File, end: u64) !GroupIndex {
    const state_index = try e2s.readSlotIndex(allocator, io, file, end);
    errdefer state_index.deinit(allocator);

    if (state_index.offsets.len != 1) {
        return error.InvalidE2SHeader;
    }

    // Read block index if not genesis era (era 0)
    var blocks_index: ?e2s.SlotIndex = null;
    if (state_index.start_slot != 0) {
        blocks_index = try e2s.readSlotIndex(allocator, io, file, state_index.record_start);
        errdefer blocks_index.?.deinit(allocator);

        if (blocks_index.?.offsets.len != preset.SLOTS_PER_HISTORICAL_ROOT) {
            return error.InvalidE2SHeader;
        }

        // Validate block and state indices are properly aligned
        const expected_block_start = try std.math.sub(u64, state_index.start_slot, preset.SLOTS_PER_HISTORICAL_ROOT);
        if (blocks_index.?.start_slot != expected_block_start) {
            return error.InvalidE2SHeader;
        }
    }

    return .{
        .state_index = state_index,
        .blocks_index = blocks_index,
    };
}

/// Read all indices from an era file
///
/// Ownership of the returned GroupIndex slice is transferred to the caller
pub fn readAllGroupIndices(allocator: std.mem.Allocator, io: std.Io, file: std.Io.File) ![]GroupIndex {
    var end: i64 = @intCast(try file.length(io));

    var group_indices = try std.ArrayList(GroupIndex).initCapacity(allocator, 1);
    errdefer {
        for (group_indices.items) |gi| {
            gi.deinit(allocator);
        }
        group_indices.deinit(allocator);
    }

    while (end > e2s.header_size) {
        const index = try readGroupIndex(allocator, io, file, @intCast(end));
        errdefer index.deinit(allocator);

        try group_indices.append(allocator, index);
        end = if (index.blocks_index) |bi|
            @as(i64, @intCast(bi.record_start)) + bi.offsets[0] - e2s.header_size
        else
            @as(i64, @intCast(index.state_index.record_start)) + index.state_index.offsets[0] - e2s.header_size;
    }

    return group_indices.toOwnedSlice(allocator);
}

pub fn isValidEraBlockSlot(slot: u64, era_number: u64) bool {
    return computeEraNumberFromBlockSlot(slot) == era_number;
}

pub fn isValidEraStateSlot(slot: u64, era_number: u64) bool {
    return slot % preset.SLOTS_PER_HISTORICAL_ROOT == 0 and slot / preset.SLOTS_PER_HISTORICAL_ROOT == era_number;
}

pub fn computeEraNumberFromBlockSlot(slot: u64) u64 {
    return slot / preset.SLOTS_PER_HISTORICAL_ROOT + 1;
}

pub fn computeStartBlockSlotFromEraNumber(era_number: u64) !u64 {
    return (try std.math.sub(u64, era_number, 1)) * preset.SLOTS_PER_HISTORICAL_ROOT;
}

pub fn getShortEraRoot(state: fork_types.AnyBeaconState) ![8]u8 {
    const allocator = std.heap.page_allocator;
    var short_era_root: [8]u8 = undefined;
    var s = state;
    var era_root: [32]u8 = undefined;
    if (try s.slot() == 0) {
        era_root = (try s.genesisValidatorsRoot()).*;
    } else if (s.forkSeq().gte(.capella)) {
        var summaries = try s.historicalSummaries();
        const len = try summaries.length();
        if (len == 0) return error.EmptyHistoricalSummaries;
        var last = try summaries.get(len - 1);
        era_root = (try last.hashTreeRoot()).*;
    } else {
        var roots = try s.historicalRoots();
        const len = try roots.length();
        if (len == 0) return error.EmptyHistoricalRoots;
        var last = try roots.get(len - 1);
        try last.toValue(allocator, &era_root);
    }

    _ = try std.fmt.bufPrint(&short_era_root, "{x}", .{era_root[0..4]});
    return short_era_root;
}

// ── Unit tests ──────────────────────────────────────────────────────────

test {
    _ = @import("era_test.zig");
}
