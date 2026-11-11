//! Execution block hash of a consensus `ExecutionPayload`: keccak256 of the
//! RLP-encoded execution block header, bellatrix through heze.
//!
//! Inputs are SSZ serializations, read at their fixed offsets. The payload
//! layout only appends fields from one fork to the next, and so does the
//! header, whose field order follows `class Header` in execution-specs
//! `src/ethereum/forks/<el_fork>/blocks.py`.
//!
//! Nothing here allocates. Transactions are hashed in place.

const std = @import("std");
const assert = std.debug.assert;
const Keccak256 = std.crypto.hash.sha3.Keccak256;
const Sha256 = std.crypto.hash.sha2.Sha256;

pub const Hash = [32]u8;

/// Discriminants are the consensus fork sequence numbers.
pub const Fork = enum(u8) {
    bellatrix = 2,
    capella = 3,
    deneb = 4,
    electra = 5,
    fulu = 6,
    gloas = 7,
    heze = 8,

    fn gte(self: Fork, other: Fork) bool {
        return @intFromEnum(self) >= @intFromEnum(other);
    }
};

pub const Error = error{
    InvalidPayload,
    InvalidTransactions,
    /// An empty transaction is a deletion in the transactions trie, so it
    /// would not change the block hash. No valid payload has one.
    EmptyTransaction,
    InvalidExecutionRequests,
    MissingParentBeaconBlockRoot,
    MissingExecutionRequests,
};

/// keccak256(rlp([])), the ommers hash of every post-merge block.
const empty_ommers_hash = hashFromHex("1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347");
/// keccak256(rlp("")), the root of a trie without entries.
pub const empty_trie_root = hashFromHex("56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421");

/// Byte offsets of the fixed part of an SSZ `ExecutionPayload`.
const field = struct {
    const parent_hash = 0;
    const fee_recipient = 32;
    const state_root = 52;
    const receipts_root = 84;
    const logs_bloom = 116;
    const prev_randao = 372;
    const block_number = 404;
    const gas_limit = 412;
    const gas_used = 420;
    const timestamp = 428;
    const extra_data_offset = 436;
    const base_fee_per_gas = 440;
    const transactions_offset = 504;
    // capella
    const withdrawals_offset = 508;
    // deneb
    const blob_gas_used = 512;
    const excess_blob_gas = 520;
    // gloas
    const block_access_list_offset = 528;
    const slot_number = 532;
};

const max_extra_data_bytes = 32;
const withdrawal_ssz_bytes = 44;
/// list header, three u64 scalars, and a 20-byte address
const withdrawal_rlp_bytes_max = 1 + 3 * 9 + 21;
const header_rlp_bytes_max = 1024;

fn payloadFixedBytes(fork: Fork) usize {
    return switch (fork) {
        .bellatrix => 508,
        .capella => 512,
        .deneb, .electra, .fulu => 528,
        .gloas, .heze => 540,
    };
}

/// Block hash of the SSZ-serialized `ExecutionPayload` of `fork`.
///
/// `parent_beacon_block_root` is required from deneb. `execution_requests`,
/// the SSZ-serialized `ExecutionRequests` of `fork`, is required from electra.
pub fn computeBlockHash(
    fork: Fork,
    payload: []const u8,
    parent_beacon_block_root: ?*const Hash,
    execution_requests: ?[]const u8,
) Error!Hash {
    const fixed_bytes = payloadFixedBytes(fork);
    if (payload.len < fixed_bytes) return error.InvalidPayload;

    // Variable fields in serialization order, each ending where the next begins
    var bounds: [5]usize = undefined;
    var bounds_len: usize = 0;
    bounds[bounds_len] = readU32(payload, field.extra_data_offset);
    bounds_len += 1;
    bounds[bounds_len] = readU32(payload, field.transactions_offset);
    bounds_len += 1;
    if (fork.gte(.capella)) {
        bounds[bounds_len] = readU32(payload, field.withdrawals_offset);
        bounds_len += 1;
    }
    if (fork.gte(.gloas)) {
        bounds[bounds_len] = readU32(payload, field.block_access_list_offset);
        bounds_len += 1;
    }
    bounds[bounds_len] = payload.len;
    bounds_len += 1;

    if (bounds[0] != fixed_bytes) return error.InvalidPayload;
    for (bounds[0 .. bounds_len - 1], bounds[1..bounds_len]) |start, end| {
        if (start > end) return error.InvalidPayload;
    }

    const extra_data = payload[bounds[0]..bounds[1]];
    if (extra_data.len > max_extra_data_bytes) return error.InvalidPayload;
    const transactions = try Transactions.init(payload[bounds[1]..bounds[2]]);

    var buffer: [header_rlp_bytes_max]u8 = undefined;
    var header: Writer = .{ .buffer = &buffer };
    header.string(payload[field.parent_hash..][0..32]);
    header.string(&empty_ommers_hash);
    header.string(payload[field.fee_recipient..][0..20]);
    header.string(payload[field.state_root..][0..32]);
    header.string(&orderedTrieRoot(.{ .transactions = transactions }));
    header.string(payload[field.receipts_root..][0..32]);
    header.string(payload[field.logs_bloom..][0..256]);
    // difficulty
    header.uint(0);
    header.uint(readU64(payload, field.block_number));
    header.uint(readU64(payload, field.gas_limit));
    header.uint(readU64(payload, field.gas_used));
    header.uint(readU64(payload, field.timestamp));
    header.string(extra_data);
    // mix_hash
    header.string(payload[field.prev_randao..][0..32]);
    // nonce
    header.string(&([_]u8{0} ** 8));
    header.uint(std.mem.readInt(u256, payload[field.base_fee_per_gas..][0..32], .little));

    // EIP-4895 withdrawals_root
    if (fork.gte(.capella)) {
        const withdrawals = payload[bounds[2]..bounds[3]];
        if (withdrawals.len % withdrawal_ssz_bytes != 0) return error.InvalidPayload;
        header.string(&orderedTrieRoot(.{ .withdrawals = withdrawals }));
    }

    // EIP-4844 blob_gas_used, excess_blob_gas, EIP-4788 parent_beacon_block_root
    if (fork.gte(.deneb)) {
        header.uint(readU64(payload, field.blob_gas_used));
        header.uint(readU64(payload, field.excess_blob_gas));
        header.string(parent_beacon_block_root orelse return error.MissingParentBeaconBlockRoot);
    }

    // EIP-7685 requests_hash
    if (fork.gte(.electra)) {
        const requests = execution_requests orelse return error.MissingExecutionRequests;
        header.string(&try computeRequestsHash(fork, requests));
    }

    // EIP-7928 block_access_list_hash, EIP-7843 slot_number
    if (fork.gte(.gloas)) {
        // The block access list is already RLP-encoded, so it is hashed as is
        var block_access_list_hash: Hash = undefined;
        Keccak256.hash(payload[bounds[3]..bounds[4]], &block_access_list_hash, .{});
        header.string(&block_access_list_hash);
        header.uint(readU64(payload, field.slot_number));
    }

    var prefix_buffer: [list_prefix_bytes_max]u8 = undefined;
    var prefix: Writer = .{ .buffer = &prefix_buffer };
    prefix.lengthPrefix(0xc0, header.len);

    var hasher = Keccak256.init(.{});
    hasher.update(prefix.written());
    hasher.update(header.written());
    var block_hash: Hash = undefined;
    hasher.final(&block_hash);
    return block_hash;
}

/// Root of the transactions trie of an SSZ-serialized transactions list.
pub fn computeTransactionsRoot(transactions: []const u8) Error!Hash {
    return orderedTrieRoot(.{ .transactions = try Transactions.init(transactions) });
}

/// EIP-7685 requests hash over the type-prefixed, non-empty request lists.
///
/// The lists have fixed-size elements, so each one's SSZ serialization is
/// already its `requests_data`, and the list's position is its request type.
fn computeRequestsHash(fork: Fork, requests: []const u8) Error!Hash {
    const lists_len: usize = if (fork.gte(.gloas)) 5 else 3;
    const fixed_bytes = lists_len * 4;
    if (requests.len < fixed_bytes) return error.InvalidExecutionRequests;

    var outer = Sha256.init(.{});
    for (0..lists_len) |request_type| {
        const start = readU32(requests, request_type * 4);
        const end = if (request_type + 1 < lists_len) readU32(requests, (request_type + 1) * 4) else requests.len;
        if (request_type == 0 and start != fixed_bytes) return error.InvalidExecutionRequests;
        if (start > end or end > requests.len) return error.InvalidExecutionRequests;
        if (start == end) continue;

        var inner = Sha256.init(.{});
        inner.update(&[_]u8{@intCast(request_type)});
        inner.update(requests[start..end]);
        var digest: Hash = undefined;
        inner.final(&digest);
        outer.update(&digest);
    }
    var requests_hash: Hash = undefined;
    outer.final(&requests_hash);
    return requests_hash;
}

/// An SSZ list of byte lists with validated offsets and no empty element.
const Transactions = struct {
    bytes: []const u8,
    count: u32,

    fn init(bytes: []const u8) Error!Transactions {
        if (bytes.len == 0) return .{ .bytes = bytes, .count = 0 };
        if (bytes.len < 4 or bytes.len > std.math.maxInt(u32)) return error.InvalidTransactions;

        const first = readU32(bytes, 0);
        if (first == 0 or first % 4 != 0 or first > bytes.len) return error.InvalidTransactions;
        const count = first / 4;

        var start = first;
        for (1..count) |i| {
            const end = readU32(bytes, i * 4);
            if (end < start or end > bytes.len) return error.InvalidTransactions;
            if (end == start) return error.EmptyTransaction;
            start = end;
        }
        if (start == bytes.len) return error.EmptyTransaction;

        return .{ .bytes = bytes, .count = count };
    }

    fn get(self: Transactions, index: u32) []const u8 {
        assert(index < self.count);
        const start = readU32(self.bytes, @as(usize, index) * 4);
        const end = if (index + 1 < self.count) readU32(self.bytes, (@as(usize, index) + 1) * 4) else self.bytes.len;
        return self.bytes[start..end];
    }
};

/// The values of a trie keyed by `rlp(index)`.
const Items = union(enum) {
    transactions: Transactions,
    /// SSZ list of `Withdrawal`, a whole number of elements
    withdrawals: []const u8,

    fn count(self: Items) u32 {
        return switch (self) {
            .transactions => |transactions| transactions.count,
            .withdrawals => |bytes| @intCast(bytes.len / withdrawal_ssz_bytes),
        };
    }

    /// The result is either a slice of the input or of `scratch`.
    fn value(self: Items, index: u32, scratch: *[withdrawal_rlp_bytes_max]u8) []const u8 {
        switch (self) {
            .transactions => |transactions| return transactions.get(index),
            .withdrawals => |bytes| {
                // Field order follows `class Withdrawal` in execution-specs `src/ethereum/forks/shanghai/blocks.py`
                const withdrawal = bytes[@as(usize, index) * withdrawal_ssz_bytes ..][0..withdrawal_ssz_bytes];
                var body_buffer: [withdrawal_rlp_bytes_max - 1]u8 = undefined;
                var body: Writer = .{ .buffer = &body_buffer };
                body.uint(readU64(withdrawal, 0));
                body.uint(readU64(withdrawal, 8));
                body.string(withdrawal[16..36]);
                body.uint(readU64(withdrawal, 36));

                var out: Writer = .{ .buffer = scratch };
                out.lengthPrefix(0xc0, body.len);
                out.append(body.written());
                return out.written();
            },
        }
    }
};

/// A key is `rlp(index)` of a u32, at most a length byte and four value bytes.
const key_nibbles_max = 10;
/// Every branch and extension above a leaf consumes at least one key nibble.
const trie_depth_max = key_nibbles_max;
/// Sixteen children, each at most a 32-byte hash with a length byte, and an empty value.
const branch_body_bytes_max = 16 * 33 + 1;
const list_prefix_bytes_max = 9;

const Key = struct {
    nibbles: [key_nibbles_max]u8,
    len: u8,

    fn init(index: u32) Key {
        var bytes: [5]u8 = undefined;
        var bytes_len: usize = 1;
        if (index == 0) {
            bytes[0] = 0x80;
        } else if (index < 0x80) {
            bytes[0] = @intCast(index);
        } else {
            const size: usize = (32 - @as(usize, @clz(index)) + 7) / 8;
            bytes[0] = @intCast(0x80 + size);
            for (0..size) |i| bytes[1 + i] = @truncate(index >> @intCast(8 * (size - 1 - i)));
            bytes_len += size;
        }

        var key: Key = .{ .nibbles = undefined, .len = @intCast(bytes_len * 2) };
        for (bytes[0..bytes_len], 0..) |byte, i| {
            key.nibbles[2 * i] = byte >> 4;
            key.nibbles[2 * i + 1] = byte & 0x0f;
        }
        return key;
    }
};

/// The index whose key is the `position`-th smallest among the keys of `count` indices.
///
/// `rlp(index)` is the index itself for 1 to 127, 0x80 for zero, and a
/// length-prefixed big-endian integer after that, so only zero is out of place.
fn indexAtSortedPosition(position: u32, count: u32) u32 {
    assert(position < count);
    const zero_position = @min(count, 0x80) - 1;
    if (position < zero_position) return position + 1;
    if (position == zero_position) return 0;
    return position;
}

/// How a node is referenced from its parent: embedded when its RLP is shorter
/// than 32 bytes, by hash otherwise.
const NodeRef = struct {
    bytes: [32]u8,
    len: u8,

    /// Reference to the list node whose RLP payload is the concatenation of `parts`.
    fn init(parts: []const []const u8) NodeRef {
        var payload_len: usize = 0;
        for (parts) |part| payload_len += part.len;

        var prefix_buffer: [list_prefix_bytes_max]u8 = undefined;
        var prefix: Writer = .{ .buffer = &prefix_buffer };
        prefix.lengthPrefix(0xc0, payload_len);

        var ref: NodeRef = .{ .bytes = undefined, .len = 32 };
        if (prefix.len + payload_len < 32) {
            var embedded: Writer = .{ .buffer = &ref.bytes };
            embedded.append(prefix.written());
            for (parts) |part| embedded.append(part);
            ref.len = @intCast(embedded.len);
        } else {
            var hasher = Keccak256.init(.{});
            hasher.update(prefix.written());
            for (parts) |part| hasher.update(part);
            hasher.final(&ref.bytes);
        }
        return ref;
    }

    fn isHash(self: *const NodeRef) bool {
        return self.len == 32;
    }

    fn writeTo(self: *const NodeRef, writer: *Writer) void {
        if (self.isHash()) {
            writer.string(&self.bytes);
        } else {
            writer.append(self.bytes[0..self.len]);
        }
    }
};

/// A node whose children are still being built. Its keys are the sorted
/// positions `[start, end)`, which share their first `depth` nibbles.
const Frame = struct {
    start: u32,
    end: u32,
    depth: u8,
    kind: union(enum) {
        /// Shares the nibbles `[depth, child_depth)` with its only child.
        extension: struct { child_depth: u8 },
        branch: struct {
            /// First position not yet given to a child.
            next_position: u32,
            /// First nibble whose slot is not yet written to `body`.
            next_nibble: u8,
            body_buffer: [branch_body_bytes_max]u8,
            body_len: u16,
        },
    },
};

/// Root of the Merkle-Patricia trie mapping `rlp(index)` to each item, as used
/// for the transactions and withdrawals roots of an execution block header.
///
/// Builds the trie depth first over the keys in sorted order, with an explicit
/// stack. No key is a prefix of another, so branch nodes never hold a value.
fn orderedTrieRoot(items: Items) Hash {
    const count = items.count();
    if (count == 0) return empty_trie_root;

    var stack: [trie_depth_max]Frame = undefined;
    var stack_len: usize = 0;
    var scratch: [withdrawal_rlp_bytes_max]u8 = undefined;

    // Either a node to build next, or the reference to the node just built
    var open: ?struct { start: u32, end: u32, depth: u8 } = .{ .start = 0, .end = count, .depth = 0 };
    var built: NodeRef = undefined;

    while (true) {
        if (open) |node| {
            open = null;
            const first = Key.init(indexAtSortedPosition(node.start, count));
            assert(node.depth <= first.len);

            if (node.end - node.start == 1) {
                const item = items.value(indexAtSortedPosition(node.start, count), &scratch);
                built = leafRef(first.nibbles[node.depth..first.len], item);
            } else {
                // Sorted, so the common prefix of all keys is the common prefix of the first and last
                const last = Key.init(indexAtSortedPosition(node.end - 1, count));
                var child_depth = node.depth;
                while (child_depth < first.len and child_depth < last.len and
                    first.nibbles[child_depth] == last.nibbles[child_depth]) child_depth += 1;

                assert(stack_len < stack.len);
                stack[stack_len] = .{
                    .start = node.start,
                    .end = node.end,
                    .depth = node.depth,
                    .kind = if (child_depth > node.depth)
                        .{ .extension = .{ .child_depth = child_depth } }
                    else
                        .{ .branch = .{
                            .next_position = node.start,
                            .next_nibble = 0,
                            .body_buffer = undefined,
                            .body_len = 0,
                        } },
                };
                stack_len += 1;
                if (child_depth > node.depth) {
                    open = .{ .start = node.start, .end = node.end, .depth = child_depth };
                    continue;
                }
            }
        }

        if (stack_len == 0) break;
        const frame = &stack[stack_len - 1];
        switch (frame.kind) {
            .extension => |extension| {
                const key = Key.init(indexAtSortedPosition(frame.start, count));
                built = extensionRef(key.nibbles[frame.depth..extension.child_depth], &built);
                stack_len -= 1;
            },
            .branch => |*branch| {
                var body: Writer = .{ .buffer = &branch.body_buffer, .len = branch.body_len };
                if (branch.next_position > frame.start) built.writeTo(&body);

                if (branch.next_position == frame.end) {
                    // Remaining children, and the value
                    for (branch.next_nibble..17) |_| body.string("");
                    built = NodeRef.init(&.{body.written()});
                    stack_len -= 1;
                    continue;
                }

                const child_start = branch.next_position;
                const child_key = Key.init(indexAtSortedPosition(child_start, count));
                assert(frame.depth < child_key.len);
                const nibble = child_key.nibbles[frame.depth];
                assert(nibble >= branch.next_nibble);
                for (branch.next_nibble..nibble) |_| body.string("");

                var child_end = child_start + 1;
                while (child_end < frame.end) : (child_end += 1) {
                    const key = Key.init(indexAtSortedPosition(child_end, count));
                    assert(frame.depth < key.len);
                    if (key.nibbles[frame.depth] != nibble) break;
                }

                branch.next_position = child_end;
                branch.next_nibble = nibble + 1;
                branch.body_len = @intCast(body.len);
                open = .{ .start = child_start, .end = child_end, .depth = frame.depth + 1 };
            },
        }
    }

    if (built.isHash()) return built.bytes;
    var root: Hash = undefined;
    Keccak256.hash(built.bytes[0..built.len], &root, .{});
    return root;
}

fn leafRef(key_nibbles: []const u8, item: []const u8) NodeRef {
    var buffer: [hex_prefix_rlp_bytes_max + list_prefix_bytes_max]u8 = undefined;
    var writer: Writer = .{ .buffer = &buffer };
    writer.hexPrefix(key_nibbles, .leaf);
    writer.stringPrefix(item);
    return NodeRef.init(&.{ writer.written(), item });
}

fn extensionRef(key_nibbles: []const u8, child: *const NodeRef) NodeRef {
    var buffer: [hex_prefix_rlp_bytes_max + 33]u8 = undefined;
    var writer: Writer = .{ .buffer = &buffer };
    writer.hexPrefix(key_nibbles, .extension);
    child.writeTo(&writer);
    return NodeRef.init(&.{writer.written()});
}

const hex_prefix_bytes_max = key_nibbles_max / 2 + 1;
const hex_prefix_rlp_bytes_max = 1 + hex_prefix_bytes_max;

/// RLP encoder over a caller-provided buffer that is large enough by construction.
const Writer = struct {
    buffer: []u8,
    len: usize = 0,

    fn written(self: *const Writer) []const u8 {
        return self.buffer[0..self.len];
    }

    fn append(self: *Writer, bytes: []const u8) void {
        assert(self.len + bytes.len <= self.buffer.len);
        @memcpy(self.buffer[self.len..][0..bytes.len], bytes);
        self.len += bytes.len;
    }

    /// Prefix of a string (`base` 0x80) or list (`base` 0xc0) with a payload of `payload_len` bytes.
    fn lengthPrefix(self: *Writer, base: u8, payload_len: usize) void {
        if (payload_len < 56) {
            self.append(&[_]u8{base + @as(u8, @intCast(payload_len))});
            return;
        }
        var big_endian: [8]u8 = undefined;
        std.mem.writeInt(u64, &big_endian, payload_len, .big);
        const size = 8 - @clz(@as(u64, payload_len)) / 8;
        self.append(&[_]u8{base + 55 + @as(u8, @intCast(size))});
        self.append(big_endian[8 - size ..]);
    }

    /// Prefix of the string `bytes`, without the bytes themselves.
    fn stringPrefix(self: *Writer, bytes: []const u8) void {
        if (bytes.len == 1 and bytes[0] < 0x80) return;
        self.lengthPrefix(0x80, bytes.len);
    }

    fn string(self: *Writer, bytes: []const u8) void {
        self.stringPrefix(bytes);
        self.append(bytes);
    }

    /// A scalar: big-endian without leading zeros.
    fn uint(self: *Writer, value: u256) void {
        var big_endian: [32]u8 = undefined;
        std.mem.writeInt(u256, &big_endian, value, .big);
        self.string(big_endian[@clz(value) / 8 ..]);
    }

    /// The hex-prefix encoding of a leaf's or extension's key nibbles, as a string.
    fn hexPrefix(self: *Writer, nibbles: []const u8, kind: enum(u8) { extension = 0, leaf = 2 }) void {
        assert(nibbles.len <= key_nibbles_max);
        var encoded: [hex_prefix_bytes_max]u8 = undefined;
        const encoded_len = nibbles.len / 2 + 1;
        const is_odd = nibbles.len % 2 == 1;
        encoded[0] = if (is_odd) (@intFromEnum(kind) + 1) << 4 | nibbles[0] else @intFromEnum(kind) << 4;
        const paired = nibbles[@intFromBool(is_odd)..];
        for (encoded[1..encoded_len], 0..) |*byte, i| byte.* = paired[2 * i] << 4 | paired[2 * i + 1];
        self.string(encoded[0..encoded_len]);
    }
};

fn readU32(bytes: []const u8, offset: usize) u32 {
    return std.mem.readInt(u32, bytes[offset..][0..4], .little);
}

fn readU64(bytes: []const u8, offset: usize) u64 {
    return std.mem.readInt(u64, bytes[offset..][0..8], .little);
}

fn hashFromHex(comptime hex: *const [64]u8) Hash {
    var hash: Hash = undefined;
    _ = std.fmt.hexToBytes(&hash, hex) catch unreachable;
    return hash;
}

test {
    _ = @import("root_test.zig");
}
