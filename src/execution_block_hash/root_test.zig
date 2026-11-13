//! Vector provenance:
//!  - bellatrix example: engine_getPayloadV1 response in the execution-apis spec
//!  - per-fork block hashes and trie boundary roots: computed with py-rlp,
//!    py-trie and eth-hash, using the header layout of the consensus-specs
//!    pyspec helper compute_el_header_block_hash. The same vectors are checked
//!    in packages/beacon-node/test/unit/execution/engine/blockHash.test.ts

const std = @import("std");
const testing = std.testing;
const Allocator = std.mem.Allocator;
const block_hash = @import("./root.zig");

const ForkSeq = @import("config").ForkSeq;
const Hash = block_hash.Hash;

const Header = struct {
    parent_hash: Hash = @splat(0x11),
    fee_recipient: [20]u8 = @splat(0x22),
    state_root: Hash = @splat(0x33),
    receipts_root: Hash = @splat(0x44),
    logs_bloom: [256]u8 = std.simd.iota(u8, 256),
    prev_randao: Hash = @splat(0x55),
    block_number: u64 = 21_000_000,
    gas_limit: u64 = 36_000_000,
    gas_used: u64 = 12_345_678,
    timestamp: u64 = 1_750_000_000,
    extra_data: []const u8 = "lodestar",
    base_fee_per_gas: u256 = 1_234_567_890_123,
};

const parent_beacon_block_root: Hash = @splat(0x66);

fn appendInt(allocator: Allocator, out: *std.ArrayList(u8), comptime T: type, value: T) !void {
    var bytes: [@sizeOf(T)]u8 = undefined;
    std.mem.writeInt(T, &bytes, value, .little);
    try out.appendSlice(allocator, &bytes);
}

/// Reserves an SSZ offset and returns its position, to be set with `setOffset`.
fn reserveOffset(allocator: Allocator, out: *std.ArrayList(u8)) !usize {
    const position = out.items.len;
    try appendInt(allocator, out, u32, 0);
    return position;
}

fn setOffset(out: *std.ArrayList(u8), position: usize, base: usize) void {
    std.mem.writeInt(u32, out.items[position..][0..4], @intCast(out.items.len - base), .little);
}

fn appendByteLists(allocator: Allocator, out: *std.ArrayList(u8), items: []const []const u8) !void {
    const base = out.items.len;
    try out.appendNTimes(allocator, 0, items.len * 4);
    for (items, 0..) |item, i| {
        setOffset(out, base + i * 4, base);
        try out.appendSlice(allocator, item);
    }
}

/// SSZ `ExecutionPayload` of `fork` with deterministic withdrawals, blob gas, block access list and slot number.
fn buildPayload(allocator: Allocator, fork: ForkSeq, header: Header, transactions: []const []const u8) ![]u8 {
    const fork_seq = @intFromEnum(fork);
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);

    try out.appendSlice(allocator, &header.parent_hash);
    try out.appendSlice(allocator, &header.fee_recipient);
    try out.appendSlice(allocator, &header.state_root);
    try out.appendSlice(allocator, &header.receipts_root);
    try out.appendSlice(allocator, &header.logs_bloom);
    try out.appendSlice(allocator, &header.prev_randao);
    try appendInt(allocator, &out, u64, header.block_number);
    try appendInt(allocator, &out, u64, header.gas_limit);
    try appendInt(allocator, &out, u64, header.gas_used);
    try appendInt(allocator, &out, u64, header.timestamp);
    const extra_data_offset = try reserveOffset(allocator, &out);
    try appendInt(allocator, &out, u256, header.base_fee_per_gas);
    // block_hash
    try out.appendNTimes(allocator, 0, 32);
    const transactions_offset = try reserveOffset(allocator, &out);
    const withdrawals_offset = if (fork_seq >= @intFromEnum(ForkSeq.capella)) try reserveOffset(allocator, &out) else null;
    if (fork_seq >= @intFromEnum(ForkSeq.deneb)) {
        try appendInt(allocator, &out, u64, 393_216);
        try appendInt(allocator, &out, u64, 1_234);
    }
    const block_access_list_offset = if (fork_seq >= @intFromEnum(ForkSeq.gloas)) try reserveOffset(allocator, &out) else null;
    if (fork_seq >= @intFromEnum(ForkSeq.gloas)) try appendInt(allocator, &out, u64, 13_000_000);

    setOffset(&out, extra_data_offset, 0);
    try out.appendSlice(allocator, header.extra_data);
    setOffset(&out, transactions_offset, 0);
    try appendByteLists(allocator, &out, transactions);
    if (withdrawals_offset) |position| {
        setOffset(&out, position, 0);
        for (0..16) |i| {
            try appendInt(allocator, &out, u64, 1_000_000 + i);
            try appendInt(allocator, &out, u64, 500_000 + i * 3);
            try out.appendNTimes(allocator, @intCast(0x70 + i), 20);
            try appendInt(allocator, &out, u64, 17_000_000 + i * 1_000);
        }
    }
    if (block_access_list_offset) |position| {
        setOffset(&out, position, 0);
        try out.appendSlice(allocator, &.{ 0xc3, 0x01, 0x02, 0x03 });
    }
    return out.toOwnedSlice(allocator);
}

/// 200 transactions, enough for branch, extension and hashed trie nodes, RLP
/// long-form items, and transaction indices that encode to 2-byte keys.
fn buildTransactions(arena: Allocator) ![]const []const u8 {
    const transactions = try arena.alloc([]u8, 200);
    for (transactions, 0..) |*transaction, i| {
        transaction.* = try arena.alloc(u8, 1 + (i % 9) * 11);
        for (transaction.*, 0..) |*byte, j| byte.* = @truncate(i * 31 + j * 7);
        transaction.*[0] = 0x02;
    }
    return transactions;
}

/// SSZ `ExecutionRequests` of `fork`: two deposits, the first with an amount
/// and index, then one default request of every other type.
fn buildExecutionRequests(allocator: Allocator, fork: ForkSeq) ![]u8 {
    const request_bytes = [_]usize{ 2 * 192, 76, 116, 184, 68 };
    const lists = request_bytes[0..if (@intFromEnum(fork) >= @intFromEnum(ForkSeq.gloas)) 5 else 3];

    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    try out.appendNTimes(allocator, 0, lists.len * 4);
    for (lists, 0..) |bytes, i| {
        setOffset(&out, i * 4, 0);
        try out.appendNTimes(allocator, 0, bytes);
    }
    const deposit = out.items[lists.len * 4 ..];
    std.mem.writeInt(u64, deposit[80..88], 32_000_000_000, .little);
    std.mem.writeInt(u64, deposit[184..192], 7, .little);
    return out.toOwnedSlice(allocator);
}

fn expectHash(expected_hex: *const [64]u8, actual: Hash) !void {
    try testing.expectEqualStrings(expected_hex, &std.fmt.bytesToHex(actual, .lower));
}

fn hashFromHex(comptime hex: *const [64]u8) Hash {
    var hash: Hash = undefined;
    _ = std.fmt.hexToBytes(&hash, hex) catch unreachable;
    return hash;
}

test "computeBlockHash matches the EL hash of a bellatrix payload" {
    const payload = try buildPayload(testing.allocator, .bellatrix, .{
        .parent_hash = comptime hashFromHex("a0513a503d5bd6e89a144c3268e5b7e9da9dbf63df125a360e3950a7d0d67131"),
        .fee_recipient = .{
            0xa9, 0x4f, 0x53, 0x74, 0xfc, 0xe5, 0xed, 0xbc, 0x8e, 0x2a,
            0x86, 0x97, 0xc1, 0x53, 0x31, 0x67, 0x7e, 0x6e, 0xbf, 0x0b,
        },
        .state_root = comptime hashFromHex("ca3149fa9e37db08d1cd49c9061db1002ef1cd58db2210f2115c8c989b2bdf45"),
        .receipts_root = comptime hashFromHex("56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421"),
        .logs_bloom = @splat(0),
        .prev_randao = @splat(0),
        .block_number = 1,
        .gas_limit = 0x989680,
        .gas_used = 0,
        .timestamp = 5,
        .extra_data = "",
        .base_fee_per_gas = 7,
    }, &.{});
    defer testing.allocator.free(payload);

    try expectHash(
        "b084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
        try block_hash.computeBlockHash(.bellatrix, payload, null, null),
    );
}

test "computeBlockHash for each fork" {
    var arena_state = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const transactions = try buildTransactions(arena);

    const vectors = [_]struct { ForkSeq, *const [64]u8 }{
        .{ .bellatrix, "33ae12e22cfee539420823b73464325df4d86120febe6eab2b91df89bf9247da" },
        .{ .capella, "b6f59257a3ce673b367c7ff2b40744e840d85ce6416e8710502242ed980a324c" },
        .{ .deneb, "e4719330bc2498bf325ca88bd3a80baa9c250a9bbff7390c54d4cb68ffec3d68" },
        .{ .electra, "1941d61f1d59dc8efee161dfe1810bde75996f499087dccccf44bf34e432ce45" },
        // Same payload and header layout as electra
        .{ .fulu, "1941d61f1d59dc8efee161dfe1810bde75996f499087dccccf44bf34e432ce45" },
        .{ .gloas, "0384d7d2f4f88f1ac3927ae9059a08e063e6a5cf7a9088572b52a693ac71ce5f" },
        // Same payload and header layout as gloas
        .{ .heze, "0384d7d2f4f88f1ac3927ae9059a08e063e6a5cf7a9088572b52a693ac71ce5f" },
    };
    for (vectors) |vector| {
        const fork, const expected = vector;
        const fork_seq = @intFromEnum(fork);
        const payload = try buildPayload(arena, fork, .{}, transactions);
        const root = if (fork_seq >= @intFromEnum(ForkSeq.deneb)) &parent_beacon_block_root else null;
        const requests = if (fork_seq >= @intFromEnum(ForkSeq.electra)) try buildExecutionRequests(arena, fork) else null;

        try expectHash(expected, try block_hash.computeBlockHash(fork, payload, root, requests));
    }
}

test "computeTransactionsRoot of no transactions is the empty trie root" {
    try testing.expectEqual(block_hash.empty_trie_root, try block_hash.computeTransactionsRoot(""));
}

// Two transactions give a branch of two 1-nibble leaves whose RLP is `len + 3` bytes, so 29 is the
// first length where a leaf must be referenced by hash instead of embedded.
test "computeTransactionsRoot at the embedded node boundary" {
    const vectors = [_]struct { usize, *const [64]u8 }{
        .{ 28, "82e166a9e47bc8433e181fb2138bffdc162e41a762c2d660ef45c697bfb38db6" },
        .{ 29, "0c42afb5b79fcf46c778821c0cb377f861d4294e525a32b6dc0fc47c0f6d2633" },
        .{ 30, "5f1cb94549b53525083956ff42b869d3f7ede982e74d3011d6ab0c1a52acc3e2" },
    };
    for (vectors) |vector| {
        const len, const expected = vector;
        var items: [2][30]u8 = undefined;
        for (&items, 0..) |*item, seed| {
            for (item, 0..) |*byte, j| byte.* = @truncate(seed * 31 + j * 7);
            item[0] = 0x02;
        }
        var list: std.ArrayList(u8) = .empty;
        defer list.deinit(testing.allocator);
        try appendByteLists(testing.allocator, &list, &.{ items[0][0..len], items[1][0..len] });

        try expectHash(expected, try block_hash.computeTransactionsRoot(list.items));
    }
}

test "computeBlockHash rejects malformed input" {
    var arena_state = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const compute = block_hash.computeBlockHash;

    const payload = try buildPayload(arena, .gloas, .{}, &.{ "\x02\x01", "\x02\x02" });
    const requests = try buildExecutionRequests(arena, .gloas);
    _ = try compute(.gloas, payload, &parent_beacon_block_root, requests);

    try testing.expectError(error.MissingParentBeaconBlockRoot, compute(.gloas, payload, null, requests));
    try testing.expectError(error.MissingExecutionRequests, compute(.gloas, payload, &parent_beacon_block_root, null));
    try testing.expectError(error.InvalidPayload, compute(.gloas, payload[0..539], &parent_beacon_block_root, requests));
    // A capella payload read as gloas has a first offset that is not the gloas fixed size
    const capella_payload = try buildPayload(arena, .capella, .{}, &.{});
    try testing.expectError(error.InvalidPayload, compute(.gloas, capella_payload, &parent_beacon_block_root, requests));
    try testing.expectError(
        error.InvalidExecutionRequests,
        compute(.gloas, payload, &parent_beacon_block_root, requests[0..19]),
    );
    const electra_payload = try buildPayload(arena, .electra, .{}, &.{});
    try testing.expectError(
        error.InvalidExecutionRequests,
        compute(.electra, electra_payload, &parent_beacon_block_root, requests),
    );

    const transactions_offset = std.mem.readInt(u32, payload[504..508], .little);
    const mutated = try arena.dupe(u8, payload);
    // Second transaction starts past the end of the payload
    std.mem.writeInt(u32, mutated[transactions_offset + 4 ..][0..4], std.math.maxInt(u32), .little);
    try testing.expectError(error.InvalidTransactions, compute(.gloas, mutated, &parent_beacon_block_root, requests));
    // Second transaction starts where the first does, leaving the first empty
    std.mem.writeInt(u32, mutated[transactions_offset + 4 ..][0..4], 8, .little);
    try testing.expectError(error.EmptyTransaction, compute(.gloas, mutated, &parent_beacon_block_root, requests));

    const empty_last = try buildPayload(arena, .bellatrix, .{}, &.{ "\x02", "" });
    try testing.expectError(error.EmptyTransaction, compute(.bellatrix, empty_last, null, null));
}
