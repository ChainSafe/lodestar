const std = @import("std");
const preset = @import("preset").preset;

/// Maximum allowed size for an entry data payload in an E2Store (.e2s) file.
/// Arbitrary limit to prevent excessive memory usage
pub const max_entry_data_size = 512 * 1024 * 1024; // 512 MiB

/// Maximum allowed number of offsets in a SlotIndex entry.
/// Arbitrary limit to prevent excessive memory usage
pub const max_slot_index_count = preset.SLOTS_PER_HISTORICAL_ROOT * 10;

/// Known entry types in an E2Store (.e2s) file along with their exact 2-byte codes.
pub const EntryType = enum(u16) {
    Empty = 0,
    CompressedSignedBeaconBlock = 1,
    CompressedBeaconState = 2,
    Version = 0x65 | (0x32 << 8), // "e2" in ASCII
    SlotIndex = 0x69 | (0x32 << 8), // "i2" in ASCII

    pub fn fromU16(bytes: u16) error{UnknownEntryType}!EntryType {
        inline for (std.meta.fields(EntryType)) |field| {
            if (bytes == @intFromEnum(@field(EntryType, field.name))) {
                return @field(EntryType, field.name);
            }
        }
        return error.UnknownEntryType;
    }

    pub fn toU16(self: EntryType) u16 {
        return @intFromEnum(self);
    }
};

/// Parsed entry from an E2Store (.e2s) file.
pub const Entry = struct {
    entry_type: EntryType,
    data: []const u8,
};

pub const SlotIndex = struct {
    /// First slot covered by this index (era * SLOTS_PER_HISTORICAL_ROOT)
    start_slot: u64,
    /// File positions where data can be found. Length varies by index type.
    offsets: []i64,
    /// File position where this index record starts
    record_start: u64,

    /// Serialize a SlotIndex into a byte array.
    ///
    /// Ownership of the returned byte array is transferred to the caller.
    pub fn serialize(self: SlotIndex, allocator: std.mem.Allocator) std.mem.Allocator.Error![]u8 {
        const count = self.offsets.len;
        const size = count * 8 + 16;

        const payload = try allocator.alloc(u8, size);
        errdefer allocator.free(payload);

        // Write start slot
        std.mem.writeInt(u64, payload[0..8], self.start_slot, .little);

        // Write offsets
        @memcpy(std.mem.bytesAsSlice(i64, payload[8 .. size - 8]), self.offsets);

        // Write count
        std.mem.writeInt(u64, payload[size - 8 ..][0..8], @intCast(count), .little);

        return payload;
    }

    pub fn deinit(self: SlotIndex, allocator: std.mem.Allocator) void {
        allocator.free(self.offsets);
    }
};

/// The complete version record.
pub const version_record_bytes = [8]u8{ 0x65, 0x32, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 };

pub const header_size = 8;

/// Read an entry at a specific offset from an open file handle.
/// Reads the header first to determine data length, then reads the complete entry.
pub const ReadError = error{
    UnknownEntryType,
    UnexpectedEOF,
    InvalidHeaderReservedBytes,
    InvalidVersionHeader,
    DataSizeTooLarge,
    UnexpectedEntryType,
    InvalidSlotIndexCount,
    Overflow,
} || std.Io.File.ReadPositionalError || std.mem.Allocator.Error;

pub fn readEntry(allocator: std.mem.Allocator, io: std.Io, file: std.Io.File, offset: u64) ReadError!Entry {
    // Read header
    var header: [8]u8 = undefined;
    const header_read_size = try file.readPositionalAll(io, &header, offset);
    if (header_read_size != header_size) {
        return error.UnexpectedEOF;
    }

    // Validate entry type from first 2 bytes (little endian)
    const entry_type = try EntryType.fromU16(std.mem.readInt(u16, header[0..2], .little));

    // Parse data length from next 4 bytes (little endian)
    const data_len = std.mem.readInt(u32, header[2..6], .little);

    if (data_len > max_entry_data_size) {
        return error.DataSizeTooLarge;
    }

    // Validate reserved bytes are zero (offset 6-7)
    if (header[6] != 0 or header[7] != 0) {
        return error.InvalidHeaderReservedBytes;
    }

    // Read entry payload/data
    const data = try allocator.alloc(u8, data_len);
    errdefer allocator.free(data);

    const data_read_size = try file.readPositionalAll(io, data, offset + header_size);
    if (data_read_size != data_len) {
        return error.UnexpectedEOF;
    }

    return .{
        .entry_type = entry_type,
        .data = data,
    };
}

pub fn readVersion(io: std.Io, file: std.Io.File, offset: u64) ReadError!void {
    var header: [8]u8 = undefined;
    const header_read_size = try file.readPositionalAll(io, &header, offset);
    if (header_read_size != header_size) {
        return error.UnexpectedEOF;
    }
    if (!std.mem.eql(u8, &header, &version_record_bytes)) {
        return error.InvalidVersionHeader;
    }
}

/// Read a SlotIndex entry at a specific offset from an open file handle.
///
/// Ownership of the returned SlotIndex is transferred to the caller.
pub fn readSlotIndex(allocator: std.mem.Allocator, io: std.Io, file: std.Io.File, offset: u64) ReadError!SlotIndex {
    const record_end = offset;
    var count_buffer: [8]u8 = undefined;
    const count_read_size = try file.readPositionalAll(io, &count_buffer, record_end - 8);
    if (count_read_size != header_size) {
        return error.UnexpectedEOF;
    }
    const count = std.mem.readInt(u64, count_buffer[0..8], .little);

    if (count > max_slot_index_count) {
        return error.InvalidSlotIndexCount;
    }

    // Validate index position is within file bounds
    const record_start = try std.math.sub(u64, record_end, (8 * count + 24));

    const entry = try readEntry(allocator, io, file, record_start);
    defer allocator.free(entry.data);

    if (entry.entry_type != EntryType.SlotIndex) {
        return error.UnexpectedEntryType;
    }

    // Size: start_slot(8) + offsets(count*8) + count(8) = count*8 + 16
    const expected_size = count * 8 + 16;
    if (entry.data.len != expected_size) {
        return error.InvalidSlotIndexCount;
    }

    // Parse start slot from payload
    const start_slot = std.mem.readInt(u64, entry.data[0..8], .little);

    // Parse offsets from payload
    const offsets = try allocator.alloc(i64, count);
    errdefer allocator.free(offsets);

    @memcpy(offsets, std.mem.bytesAsSlice(i64, entry.data[8 .. entry.data.len - 8]));

    return .{
        .start_slot = start_slot,
        .offsets = offsets,
        .record_start = record_start,
    };
}

pub const WriteError = error{} || std.Io.File.WritePositionalError;

pub fn writeEntry(io: std.Io, file: std.Io.File, offset: u64, entry_type: EntryType, payload: []const u8) WriteError!void {
    var header: [8]u8 = [_]u8{0} ** 8;
    std.mem.writeInt(u16, header[0..2], entry_type.toU16(), .little);
    std.mem.writeInt(u32, header[2..6], @intCast(payload.len), .little);
    try file.writePositionalAll(io, &header, offset);
    try file.writePositionalAll(io, payload, offset + header_size);
}

pub fn writeVersion(io: std.Io, file: std.Io.File, offset: u64) WriteError!void {
    try file.writePositionalAll(io, &version_record_bytes, offset);
}

// ── Unit tests ──────────────────────────────────────────────────────────

test {
    _ = @import("e2s_test.zig");
}
