//! Tests for `e2s.zig`.

const std = @import("std");
const e2s_mod = @import("e2s.zig");
const EntryType = e2s_mod.EntryType;
const SlotIndex = e2s_mod.SlotIndex;
const version_record_bytes = e2s_mod.version_record_bytes;

test "EntryType.fromU16 - known types" {
    try std.testing.expectEqual(EntryType.Empty, try EntryType.fromU16(0));
    try std.testing.expectEqual(EntryType.CompressedSignedBeaconBlock, try EntryType.fromU16(1));
    try std.testing.expectEqual(EntryType.CompressedBeaconState, try EntryType.fromU16(2));
    try std.testing.expectEqual(EntryType.Version, try EntryType.fromU16(0x3265));
    try std.testing.expectEqual(EntryType.SlotIndex, try EntryType.fromU16(0x3269));
}

test "EntryType.fromU16 - unknown type returns error" {
    try std.testing.expectError(error.UnknownEntryType, EntryType.fromU16(0xFFFF));
    try std.testing.expectError(error.UnknownEntryType, EntryType.fromU16(3));
    try std.testing.expectError(error.UnknownEntryType, EntryType.fromU16(42));
}

test "EntryType.toU16 - roundtrip" {
    inline for (std.meta.fields(EntryType)) |field| {
        const entry = @field(EntryType, field.name);
        try std.testing.expectEqual(entry, try EntryType.fromU16(entry.toU16()));
    }
}

test "EntryType - Version is 'e2' in ASCII" {
    // 'e' = 0x65, '2' = 0x32, little-endian u16 = 0x3265
    try std.testing.expectEqual(@as(u16, 0x3265), EntryType.Version.toU16());
}

test "EntryType - SlotIndex is 'i2' in ASCII" {
    // 'i' = 0x69, '2' = 0x32, little-endian u16 = 0x3269
    try std.testing.expectEqual(@as(u16, 0x3269), EntryType.SlotIndex.toU16());
}

test "SlotIndex.serialize - basic" {
    const allocator = std.testing.allocator;
    const offsets = try allocator.alloc(i64, 2);
    defer allocator.free(offsets);
    offsets[0] = 100;
    offsets[1] = 200;

    const index = SlotIndex{
        .start_slot = 8192,
        .offsets = offsets,
        .record_start = 0,
    };

    const serialized = try index.serialize(allocator);
    defer allocator.free(serialized);

    // Size: 2 offsets * 8 + 16 = 32 bytes
    try std.testing.expectEqual(@as(usize, 32), serialized.len);

    // First 8 bytes: start_slot (8192 = 0x2000 LE)
    try std.testing.expectEqual(@as(u64, 8192), std.mem.readInt(u64, serialized[0..8], .little));

    // Middle 16 bytes: offsets
    try std.testing.expectEqual(@as(i64, 100), std.mem.readInt(i64, serialized[8..16], .little));
    try std.testing.expectEqual(@as(i64, 200), std.mem.readInt(i64, serialized[16..24], .little));

    // Last 8 bytes: count (2)
    try std.testing.expectEqual(@as(u64, 2), std.mem.readInt(u64, serialized[24..32], .little));
}

test "version_record_bytes" {
    // Version record is: type=0x3265 ("e2"), length=0, reserved=0
    try std.testing.expectEqual(@as(u8, 0x65), version_record_bytes[0]); // 'e'
    try std.testing.expectEqual(@as(u8, 0x32), version_record_bytes[1]); // '2'
    // Rest should be zeros (length=0, reserved=0)
    for (version_record_bytes[2..]) |b| {
        try std.testing.expectEqual(@as(u8, 0), b);
    }
}
