const std = @import("std");
const types = @import("consensus_types");
const pubkey_cache = @import("pubkey_cache.zig");
const PubkeyCache = pubkey_cache.PubkeyCache;
const pkix = @import("pkix.zig");
const PkixHeader = pkix.testing.Header;
const header_size = @sizeOf(PkixHeader);
const interop = @import("../test_utils/interop_pubkeys.zig");
const testing = std.testing;

fn loadPkixForTest(
    allocator: std.mem.Allocator,
    reader: *std.Io.Reader,
    file_size: u64,
) !PubkeyCache {
    return pkix.load(
        allocator,
        testing.io,
        reader,
        file_size,
        std.math.maxInt(usize),
    );
}

fn encodePkixForTest(allocator: std.mem.Allocator, cache: *PubkeyCache) ![]u8 {
    var allocating_writer: std.Io.Writer.Allocating = .init(allocator);
    errdefer allocating_writer.deinit();
    try pkix.save(cache, testing.io, &allocating_writer.writer);
    return allocating_writer.toOwnedSlice();
}

fn updatePkixChecksumForTest(bytes: []u8) void {
    var header = readHeaderForTest(bytes);
    header.payload_checksum = std.hash.XxHash3.hash(
        pkix.testing.payload_seed,
        bytes[header_size..],
    );
    updateHeaderChecksumForTest(&header);
    writeHeaderForTest(bytes, header);
}

fn readHeaderForTest(bytes: []const u8) PkixHeader {
    std.debug.assert(bytes.len >= header_size);
    return std.mem.bytesToValue(PkixHeader, bytes[0..header_size]);
}

fn writeHeaderForTest(bytes: []u8, header: PkixHeader) void {
    std.debug.assert(bytes.len >= header_size);
    @memcpy(bytes[0..header_size], std.mem.asBytes(&header));
}

fn updateHeaderChecksumForTest(header: *PkixHeader) void {
    header.header_checksum = std.hash.XxHash3.hash(
        pkix.testing.header_seed,
        std.mem.asBytes(header)[0..@offsetOf(PkixHeader, "header_checksum")],
    );
}

fn appendPubkeys(
    cache: *PubkeyCache,
    pubkeys: []const types.primitive.BLSPubkey.Type,
) !void {
    for (pubkeys, 0..) |pubkey, index| {
        try cache.append(testing.io, pubkey, index);
    }
}

test "PKIX round trip preserves populated and empty caches" {
    const allocator = testing.allocator;
    var pubkeys: [3]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);

    var source = try PubkeyCache.initCapacity(allocator, testing.io, 8);
    defer source.deinit();
    source.hash_key = @splat(0x11);
    try appendPubkeys(&source, &pubkeys);

    var same_entries = try PubkeyCache.initCapacity(allocator, testing.io, 8);
    defer same_entries.deinit();
    same_entries.hash_key = @splat(0xee);
    try appendPubkeys(&same_entries, &pubkeys);

    const encoded = try encodePkixForTest(allocator, &source);
    defer allocator.free(encoded);
    const same_entries_encoded = try encodePkixForTest(allocator, &same_entries);
    defer allocator.free(same_entries_encoded);
    try testing.expectEqualSlices(u8, encoded, same_entries_encoded);
    try testing.expectEqual(
        std.hash.XxHash3.hash(pkix.testing.payload_seed, encoded[header_size..]),
        readHeaderForTest(encoded).payload_checksum,
    );

    var reader = std.Io.Reader.fixed(encoded);
    var loaded = try loadPkixForTest(allocator, &reader, encoded.len);
    defer loaded.deinit();
    try testing.expectEqual(source.count(testing.io), loaded.count(testing.io));
    try testing.expectEqual(source.capacity(testing.io), loaded.capacity(testing.io));
    for (pubkeys, 0..) |pubkey, index| {
        try testing.expectEqual(
            @as(u64, @intCast(index)),
            loaded.get(testing.io, pubkey).?,
        );
        const compressed = loaded.getPubkey(testing.io, index).?.compress();
        try testing.expectEqualSlices(u8, &pubkey, &compressed);
    }

    var empty_source = try PubkeyCache.initCapacity(allocator, testing.io, 32);
    defer empty_source.deinit();
    const empty_encoded = try encodePkixForTest(allocator, &empty_source);
    defer allocator.free(empty_encoded);
    try testing.expectEqual(header_size, empty_encoded.len);

    var empty_reader = std.Io.Reader.fixed(empty_encoded);
    var empty_loaded = try loadPkixForTest(allocator, &empty_reader, empty_encoded.len);
    defer empty_loaded.deinit();
    try testing.expectEqual(@as(u32, 0), empty_loaded.count(testing.io));
    try testing.expectEqual(
        empty_source.capacity(testing.io),
        empty_loaded.capacity(testing.io),
    );
}

test "PKIX install replaces contents across allocators and remains usable" {
    const allocator = testing.allocator;
    var pubkeys: [3]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);

    var source = try PubkeyCache.initCapacity(allocator, testing.io, 4);
    defer source.deinit();
    try appendPubkeys(&source, pubkeys[1..]);

    const encoded = try encodePkixForTest(allocator, &source);
    defer allocator.free(encoded);
    var reader = std.Io.Reader.fixed(encoded);
    var staged = try loadPkixForTest(
        std.heap.page_allocator,
        &reader,
        encoded.len,
    );
    defer staged.deinit();

    var live = try PubkeyCache.initCapacity(allocator, testing.io, 1);
    defer live.deinit();
    try live.append(testing.io, pubkeys[0], 0);

    try pkix.install(&live, testing.io, &staged);

    try testing.expectEqual(@as(u32, 0), staged.count(testing.io));
    try testing.expectEqual(@as(u32, 2), live.count(testing.io));
    try testing.expectEqual(@as(?u64, null), live.get(testing.io, pubkeys[0]));
    try testing.expectEqual(@as(u64, 0), live.get(testing.io, pubkeys[1]).?);
    try testing.expectEqual(@as(u64, 1), live.get(testing.io, pubkeys[2]).?);

    try live.append(testing.io, pubkeys[0], 2);
    try testing.expectEqual(@as(u64, 2), live.get(testing.io, pubkeys[0]).?);
}

test "PKIX rejects payload corruption and inexact reads" {
    const allocator = testing.allocator;
    var pubkeys: [1]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);
    var source = try PubkeyCache.initCapacity(allocator, testing.io, pubkeys.len);
    defer source.deinit();
    try source.append(testing.io, pubkeys[0], 0);

    const encoded = try encodePkixForTest(allocator, &source);
    defer allocator.free(encoded);

    encoded[encoded.len - 1] ^= 1;
    var corrupted_reader = std.Io.Reader.fixed(encoded);
    try testing.expectError(
        error.InvalidPkixChecksum,
        loadPkixForTest(allocator, &corrupted_reader, encoded.len),
    );
    encoded[encoded.len - 1] ^= 1;

    var truncated_reader = std.Io.Reader.fixed(encoded);
    try testing.expectError(
        error.InvalidPkixHeader,
        loadPkixForTest(allocator, &truncated_reader, encoded.len - 1),
    );
    var trailing_reader = std.Io.Reader.fixed(encoded);
    try testing.expectError(
        error.InvalidPkixHeader,
        loadPkixForTest(allocator, &trailing_reader, encoded.len + 1),
    );

    // The file may be truncated after its size is read.
    var short_reader = std.Io.Reader.fixed(encoded[0 .. encoded.len - 1]);
    try testing.expectError(
        error.InvalidPkixPayload,
        loadPkixForTest(allocator, &short_reader, encoded.len),
    );

    var empty_source = try PubkeyCache.initCapacity(allocator, testing.io, 32);
    defer empty_source.deinit();
    const empty_encoded = try encodePkixForTest(allocator, &empty_source);
    defer allocator.free(empty_encoded);

    var empty_header = readHeaderForTest(empty_encoded);
    empty_header.payload_checksum ^= 1;
    updateHeaderChecksumForTest(&empty_header);
    writeHeaderForTest(empty_encoded, empty_header);
    var failing = testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    var empty_reader = std.Io.Reader.fixed(empty_encoded);
    try testing.expectError(
        error.InvalidPkixChecksum,
        pkix.load(
            failing.allocator(),
            testing.io,
            &empty_reader,
            empty_encoded.len,
            std.math.maxInt(usize),
        ),
    );
}

test "PKIX rejects incompatible and malformed headers" {
    const allocator = testing.allocator;
    var source = PubkeyCache.init(allocator, testing.io);
    defer source.deinit();
    const encoded = try encodePkixForTest(allocator, &source);
    defer allocator.free(encoded);

    const Mutation = struct {
        offset: usize,
        expected_error: anyerror,
    };
    const mutations = [_]Mutation{
        .{
            .offset = @offsetOf(PkixHeader, "magic"),
            .expected_error = error.InvalidPkixMagic,
        },
        .{
            .offset = @offsetOf(PkixHeader, "version"),
            .expected_error = error.UnsupportedPkixVersion,
        },
        .{
            .offset = @offsetOf(PkixHeader, "abi_fingerprint"),
            .expected_error = error.IncompatiblePkixAbi,
        },
    };

    for (mutations) |mutation| {
        encoded[mutation.offset] ^= 1;
        updatePkixChecksumForTest(encoded);
        var reader = std.Io.Reader.fixed(encoded);
        try testing.expectError(
            mutation.expected_error,
            loadPkixForTest(allocator, &reader, encoded.len),
        );
        encoded[mutation.offset] ^= 1;
        updatePkixChecksumForTest(encoded);
    }

    var header = readHeaderForTest(encoded);
    header.cache_capacity = 1 << 30;
    writeHeaderForTest(encoded, header);
    var failing = testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    var checksum_reader = std.Io.Reader.fixed(encoded);
    try testing.expectError(
        error.InvalidPkixHeaderChecksum,
        pkix.load(
            failing.allocator(),
            testing.io,
            &checksum_reader,
            encoded.len,
            std.math.maxInt(usize),
        ),
    );

    header = readHeaderForTest(encoded);
    header.cache_capacity = 0;
    header.entry_count = 1;
    updateHeaderChecksumForTest(&header);
    writeHeaderForTest(encoded, header);
    var count_reader = std.Io.Reader.fixed(encoded);
    try testing.expectError(
        error.InvalidPkixHeader,
        loadPkixForTest(allocator, &count_reader, encoded.len),
    );
}

test "PKIX enforces the caller capacity limit before allocation" {
    const allocator = testing.allocator;
    var pubkeys: [3]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);

    var source = try PubkeyCache.initCapacity(allocator, testing.io, 32);
    defer source.deinit();
    try appendPubkeys(&source, &pubkeys);

    const encoded = try encodePkixForTest(allocator, &source);
    defer allocator.free(encoded);

    var accepted_reader = std.Io.Reader.fixed(encoded);
    var loaded = try pkix.load(
        allocator,
        testing.io,
        &accepted_reader,
        encoded.len,
        pubkeys.len,
    );
    defer loaded.deinit();
    try testing.expectEqual(@as(u32, pubkeys.len), loaded.count(testing.io));
    try testing.expectEqual(@as(usize, pubkeys.len), loaded.capacity(testing.io));
    for (pubkeys, 0..) |pubkey, index| {
        try testing.expectEqual(
            @as(u64, @intCast(index)),
            loaded.get(testing.io, pubkey).?,
        );
    }

    var failing = testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    var rejected_reader = std.Io.Reader.fixed(encoded);
    try testing.expectError(
        error.PkixCapacityLimitExceeded,
        pkix.load(
            failing.allocator(),
            testing.io,
            &rejected_reader,
            encoded.len,
            pubkeys.len - 1,
        ),
    );

    var empty_source = PubkeyCache.init(allocator, testing.io);
    defer empty_source.deinit();
    const empty_encoded = try encodePkixForTest(allocator, &empty_source);
    defer allocator.free(empty_encoded);
    var empty_header = readHeaderForTest(empty_encoded);
    empty_header.cache_capacity = 1 << 30;
    updateHeaderChecksumForTest(&empty_header);
    writeHeaderForTest(empty_encoded, empty_header);

    var empty_failing = testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    var empty_reader = std.Io.Reader.fixed(empty_encoded);
    var empty_loaded = try pkix.load(
        empty_failing.allocator(),
        testing.io,
        &empty_reader,
        empty_encoded.len,
        0,
    );
    defer empty_loaded.deinit();
    try testing.expectEqual(@as(u32, 0), empty_loaded.count(testing.io));
    try testing.expectEqual(@as(usize, 0), empty_loaded.capacity(testing.io));
}
