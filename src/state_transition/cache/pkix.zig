const std = @import("std");
const builtin = @import("builtin");
const bls = @import("bls");
const pubkey_cache = @import("pubkey_cache.zig");
const PubkeyCache = pubkey_cache.PubkeyCache;

const magic = "PKIX".*;
const format_version: u32 = 5;
const payload_checksum_seed: u64 = 0;
const header_checksum_seed: u64 = 0x504b495848445235;

const Header = extern struct {
    magic: [4]u8,
    version: u32,
    abi_fingerprint: u64,
    entry_count: u32,
    cache_capacity: u32,
    payload_checksum: u64,
    header_checksum: u64,

    fn init(entry_count: u32, cache_capacity: u32) Header {
        return .{
            .magic = magic,
            .version = format_version,
            .abi_fingerprint = abi_fingerprint,
            .entry_count = entry_count,
            .cache_capacity = cache_capacity,
            .payload_checksum = 0,
            .header_checksum = 0,
        };
    }

    fn finish(
        self: *Header,
        key_bytes: []const u8,
        affine_bytes: []const u8,
    ) void {
        var checksum = std.hash.XxHash3.init(payload_checksum_seed);
        checksum.update(key_bytes);
        checksum.update(affine_bytes);
        self.payload_checksum = checksum.final();
        self.header_checksum = headerChecksum(self);
    }

    fn decode(encoded: *const [@sizeOf(Header)]u8) !Header {
        const header = std.mem.bytesToValue(Header, encoded);
        if (!std.mem.eql(u8, &header.magic, &magic)) {
            return error.InvalidPkixMagic;
        }
        if (header.version != format_version) {
            return error.UnsupportedPkixVersion;
        }
        if (header.abi_fingerprint != abi_fingerprint) {
            return error.IncompatiblePkixAbi;
        }
        if (header.header_checksum != headerChecksum(&header)) {
            return error.InvalidPkixHeaderChecksum;
        }
        return header;
    }
};
const PkixHeader = Header;

const header_size = @sizeOf(Header);

const AffinePoint = @TypeOf(@as(bls.PublicKey, undefined).point);
const BaseField = @TypeOf(@as(AffinePoint, undefined).x);
const Limbs = @TypeOf(@as(BaseField, undefined).l);

// Raw affine bytes are safe only while every byte belongs to initialized BLST
// limbs.
comptime {
    if (@offsetOf(bls.PublicKey, "point") != 0 or
        @sizeOf(bls.PublicKey) != @sizeOf(AffinePoint) or
        @offsetOf(AffinePoint, "x") != 0 or
        @offsetOf(AffinePoint, "y") != @sizeOf(BaseField) or
        @sizeOf(AffinePoint) != 2 * @sizeOf(BaseField) or
        @offsetOf(BaseField, "l") != 0 or
        @sizeOf(BaseField) != @sizeOf(Limbs))
    {
        @compileError("PKIX requires a padding-free BLST affine layout");
    }
    if (@offsetOf(Header, "magic") != 0 or
        @offsetOf(Header, "version") != 4 or
        @offsetOf(Header, "abi_fingerprint") != 8 or
        @offsetOf(Header, "entry_count") != 16 or
        @offsetOf(Header, "cache_capacity") != 20 or
        @offsetOf(Header, "payload_checksum") != 24 or
        @offsetOf(Header, "header_checksum") != 32 or
        @sizeOf(Header) != 40)
    {
        @compileError("unexpected PKIX header layout");
    }
}

const abi_description = std.fmt.comptimePrint(
    "version={d};zig={s};arch={s};os={s};abi={s};endian={s};" ++
        "header={d};pubkey={d}/{d}/{d};affine={d}/{d}/{d};" ++
        "fp={d}/{d};limbs={d}/{d};",
    .{
        format_version,
        builtin.zig_version_string,
        @tagName(builtin.target.cpu.arch),
        @tagName(builtin.target.os.tag),
        @tagName(builtin.target.abi),
        @tagName(builtin.target.cpu.arch.endian()),
        @sizeOf(Header),
        @sizeOf(bls.PublicKey),
        @alignOf(bls.PublicKey),
        @offsetOf(bls.PublicKey, "point"),
        @sizeOf(AffinePoint),
        @alignOf(AffinePoint),
        @offsetOf(AffinePoint, "y"),
        @sizeOf(BaseField),
        @alignOf(BaseField),
        @sizeOf(Limbs),
        @alignOf(Limbs),
    },
);

const abi_fingerprint = std.hash.XxHash3.hash(
    payload_checksum_seed,
    abi_description,
);

fn payloadSize(entry_count: u32) usize {
    const count: usize = @intCast(entry_count);
    return count * (@sizeOf([48]u8) + @sizeOf(bls.PublicKey));
}

fn payloadChecksum(payload: []const u8) u64 {
    return std.hash.XxHash3.hash(payload_checksum_seed, payload);
}

fn headerChecksum(header: *const Header) u64 {
    return std.hash.XxHash3.hash(
        header_checksum_seed,
        std.mem.asBytes(header)[0..@offsetOf(Header, "header_checksum")],
    );
}

fn readAndHash(
    reader: *std.Io.Reader,
    checksum: *std.hash.XxHash3,
    bytes: []u8,
) !void {
    reader.readSliceAll(bytes) catch |err| switch (err) {
        error.EndOfStream => return error.InvalidPkixPayload,
        else => |e| return e,
    };
    checksum.update(bytes);
}

/// Write a native, ABI-locked PKIX snapshot.
///
/// The payload contains insertion-ordered compressed keys followed by affine
/// public keys. Runtime hash state is rebuilt on load and is never persisted.
/// The shared lock spans output, so the writer must not mutate the cache.
pub fn save(cache: *PubkeyCache, io: std.Io, writer: *std.Io.Writer) !void {
    try cache.lock.lockShared(io);
    defer cache.lock.unlockShared(io);

    const entry_count: u32 = @intCast(cache.entries.count());
    const cache_capacity: u32 = @intCast(cache.entries.capacity());
    std.debug.assert(entry_count <= cache_capacity);

    const key_bytes = std.mem.sliceAsBytes(cache.entries.keys());
    const affine_bytes = std.mem.sliceAsBytes(cache.entries.values());
    var header = Header.init(entry_count, cache_capacity);
    header.finish(key_bytes, affine_bytes);

    try writer.writeAll(std.mem.asBytes(&header));
    try writer.writeAll(key_bytes);
    try writer.writeAll(affine_bytes);
}

/// Load a native PKIX snapshot into a fresh cache.
///
/// PKIX checks framing, ABI compatibility, bounds, and checksum, but does not
/// authenticate or semantically validate entries. Callers must provide an
/// application-owned file from the intended network.
///
/// The supported trust assumption is that `load` receives only PKIX files
/// produced by this file's `save`. Entry-level cache invariants are inherited
/// from caches built through `append` and `save` and are not revalidated by
/// `load`.
pub fn load(
    allocator: std.mem.Allocator,
    io: std.Io,
    reader: *std.Io.Reader,
    file_size: u64,
    max_capacity: usize,
) !PubkeyCache {
    if (file_size < header_size) return error.InvalidPkixHeader;
    const encoded_header = reader.takeArray(header_size) catch |err| switch (err) {
        error.EndOfStream => return error.InvalidPkixHeader,
        else => |e| return e,
    };
    const header = try Header.decode(encoded_header);

    if (header.entry_count > header.cache_capacity) {
        return error.InvalidPkixHeader;
    }
    const entry_count = std.math.cast(usize, header.entry_count) orelse
        return error.InvalidPkixHeader;
    if (entry_count > max_capacity) return error.PkixCapacityLimitExceeded;
    if (entry_count > pubkey_cache.max_capacity) return error.InvalidPkixHeader;

    const encoded_capacity = std.math.cast(usize, header.cache_capacity) orelse
        return error.InvalidPkixHeader;
    const cache_capacity = @min(
        encoded_capacity,
        max_capacity,
        pubkey_cache.max_capacity,
    );
    const payload_size = payloadSize(header.entry_count);
    const expected_file_size: u64 = @intCast(header_size + payload_size);
    if (file_size != expected_file_size) return error.InvalidPkixHeader;

    // An empty payload can be checked before its reserved capacity is allocated.
    if (payload_size == 0 and header.payload_checksum != payloadChecksum(&.{})) {
        return error.InvalidPkixChecksum;
    }

    var cache = PubkeyCache.init(allocator, io);
    errdefer cache.deinit();

    if (cache_capacity != 0) {
        try cache.entries.entries.setCapacity(allocator, cache_capacity);
    }
    try cache.entries.entries.resize(allocator, header.entry_count);

    const key_bytes = std.mem.sliceAsBytes(cache.entries.keys());
    const affine_bytes = std.mem.sliceAsBytes(cache.entries.values());
    var checksum = std.hash.XxHash3.init(payload_checksum_seed);
    try readAndHash(reader, &checksum, key_bytes);
    try readAndHash(reader, &checksum, affine_bytes);
    if (checksum.final() != header.payload_checksum) {
        return error.InvalidPkixChecksum;
    }

    try cache.entries.reIndexContext(allocator, cache.hashContext());
    return cache;
}

/// Install staged PKIX contents without replacing the live cache or its locks.
/// `staged` must be exclusively owned. Its allocator backing must remain valid
/// for the destination cache's lifetime after transfer.
/// `staged` remains valid and empty on success.
pub fn install(cache: *PubkeyCache, io: std.Io, staged: *PubkeyCache) !void {
    std.debug.assert(cache != staged);

    try cache.lock.lock(io);
    defer cache.lock.unlock(io);

    std.mem.swap(@TypeOf(cache.allocator), &cache.allocator, &staged.allocator);
    std.mem.swap(@TypeOf(cache.entries), &cache.entries, &staged.entries);
    std.mem.swap(@TypeOf(cache.hash_key), &cache.hash_key, &staged.hash_key);
    staged.entries.deinit(staged.allocator);
    staged.entries = .empty;
}

pub const testing = if (builtin.is_test) struct {
    pub const Header = PkixHeader;
    pub const payload_seed = payload_checksum_seed;
    pub const header_seed = header_checksum_seed;
} else struct {};

test {
    _ = @import("pkix_test.zig");
}
