//! Ethereum claims are copied only after canonical ENR signature verification. Endpoint
//! reachability and transport authentication remain separate admission boundaries.
const std = @import("std");
const d = @import("discv5");
const types = @import("types.zig");
const keys = @import("../wire/keys.zig");
const Record = d.identity.enr.Record;

pub const Error = d.identity.enr.Error || keys.Error || error{ InvalidField, MissingEth2, IncompatibleFork, InvalidForkContext, SequenceExhausted, IdentityMismatch };
pub const ForkId = struct { digest: [4]u8, next_version: [4]u8, next_epoch: u64 };
pub const Hints = struct {
    sequence: u64,
    record_hash: [32]u8,
    fork: ForkId,
    next_fork_digest: ?[4]u8,
    attnets: ?[8]u8,
    syncnets: ?u8,
    custody_group_count: ?u64,

    pub fn validFor(self: *const Hints, context: *const types.ForkContext) bool {
        context.validate() catch return false;
        if (!std.mem.eql(u8, &self.fork.digest, &context.digest)) return false;
        if (self.syncnets) |bits| if (bits & 0xf0 != 0) return false;
        if (self.custody_group_count) |count| if (count > context.custody_groups) return false;
        return true;
    }
};

pub const Candidate = struct {
    peer: types.PeerId,
    node_id: d.types.NodeId,
    addresses: [2]types.Address = @splat(.unspecified),
    address_count: u8 = 0,
    hints: Hints,
};

/// Borrows an immutable authenticated Record; application claims still require validation.
pub fn decode(record: *const Record, context: *const types.ForkContext) Error!Candidate {
    try context.validate();
    const eth2 = (try fixed(record, "eth2", 16)) orelse return error.MissingEth2;
    if (!std.mem.eql(u8, eth2[0..4], &context.digest)) return error.IncompatibleFork;
    const syncnets = try fixed(record, "syncnets", 1);
    if (syncnets) |bits| if (bits[0] & 0xf0 != 0) return error.InvalidField;
    const custody = try integer(record, "cgc", 8);
    if (custody) |count| if (count > context.custody_groups) return error.InvalidField;
    const public_key: keys.PublicKey = .{ .bytes = record.public_key };
    var result = Candidate{
        .peer = types.PeerId.fromPublicKey(&public_key),
        .node_id = record.node_id,
        .hints = .{
            .sequence = record.sequence,
            .record_hash = try record.contentHash(),
            .fork = .{ .digest = eth2[0..4].*, .next_version = eth2[4..8].*, .next_epoch = std.mem.readInt(u64, eth2[8..16], .little) },
            .next_fork_digest = try fixed(record, "nfd", 4),
            .attnets = try fixed(record, "attnets", 8),
            .syncnets = if (syncnets) |bits| bits[0] else null,
            .custody_group_count = custody,
        },
    };
    const quic = try integer(record, "quic", 2);
    const quic6 = try integer(record, "quic6", 2);
    if (record.ip4) |ip| if (quic) |port| {
        if (port != 0 and !std.mem.allEqual(u8, &ip, 0)) {
            result.addresses[result.address_count] = .{ .ip4 = .{ .octets = ip, .port = @intCast(port) } };
            result.address_count += 1;
        }
    };
    if (record.ip6) |ip| if (quic6) |port| {
        if (port != 0 and !std.mem.allEqual(u8, &ip, 0) and !types.Address.isIp4Mapped(ip)) {
            result.addresses[result.address_count] = .{ .ip6 = .{ .octets = ip, .port = @intCast(port) } };
            result.address_count += 1;
        }
    };
    return result;
}

fn fixed(record: *const Record, key: []const u8, comptime length: usize) Error!?[length]u8 {
    const bytes = (record.fieldBytes(key) catch return error.InvalidField) orelse return null;
    if (bytes.len != length) return error.InvalidField;
    return bytes[0..length].*;
}

fn integer(record: *const Record, key: []const u8, limit: usize) Error!?u64 {
    const bytes = (record.fieldBytes(key) catch return error.InvalidField) orelse return null;
    if (bytes.len > limit or (bytes.len != 0 and bytes[0] == 0)) return error.InvalidField;
    var value: u64 = 0;
    for (bytes) |byte| value = (value << 8) | byte;
    return value;
}

pub const LocalAdvertisement = struct {
    fork: ForkId,
    ip4: ?[4]u8 = null,
    ip6: ?[16]u8 = null,
    udp: ?u16 = null,
    udp6: ?u16 = null,
    quic: ?u16 = null,
    quic6: ?u16 = null,
    next_fork_digest: ?[4]u8 = null,
    attnets: ?[8]u8 = null,
    syncnets: ?u8 = null,
    custody_group_count: ?u64 = null,
};

/// Builds a signed record. The owner advances the sequence when advertised fields change.
/// The trusted caller enforces scheduling: once Fulu is scheduled, supply cgc and nfd, using
/// zero nfd when no later fork is scheduled. ForkContext alone does not describe that schedule.
pub fn build(key: *const d.identity.crypto.KeyPair, sequence: u64, local: *const LocalAdvertisement, context: *const types.ForkContext) Error!Record {
    if (local.custody_group_count == 0) return error.InvalidField;
    if (local.ip6) |ip| if (types.Address.isIp4Mapped(ip)) return error.InvalidField;
    var eth2: [16]u8 = undefined;
    @memcpy(eth2[0..4], &local.fork.digest);
    @memcpy(eth2[4..8], &local.fork.next_version);
    std.mem.writeInt(u64, eth2[8..16], local.fork.next_epoch, .little);
    const public_key = d.identity.crypto.compressedPublicKey(key);
    var fields: [13]d.identity.enr.Field = undefined;
    var count: usize = 0;
    if (local.attnets) |*value| append(&fields, &count, "attnets", .{ .bytes = value });
    if (local.custody_group_count) |value| append(&fields, &count, "cgc", .{ .uint = value });
    append(&fields, &count, "eth2", .{ .bytes = &eth2 });
    append(&fields, &count, "id", .{ .bytes = "v4" });
    if (local.ip4) |*value| append(&fields, &count, "ip", .{ .bytes = value });
    if (local.ip6) |*value| append(&fields, &count, "ip6", .{ .bytes = value });
    if (local.next_fork_digest) |*value| append(&fields, &count, "nfd", .{ .bytes = value });
    if (local.quic) |value| append(&fields, &count, "quic", .{ .uint = value });
    if (local.quic6) |value| append(&fields, &count, "quic6", .{ .uint = value });
    append(&fields, &count, "secp256k1", .{ .bytes = &public_key });
    if (local.syncnets) |*value| append(&fields, &count, "syncnets", .{ .bytes = std.mem.asBytes(value) });
    if (local.udp) |value| append(&fields, &count, "udp", .{ .uint = value });
    if (local.udp6) |value| append(&fields, &count, "udp6", .{ .uint = value });
    const record = try Record.createFields(key, sequence, fields[0..count]);
    _ = try decode(&record, context);
    return record;
}

fn append(fields: *[13]d.identity.enr.Field, count: *usize, key: []const u8, value: d.identity.enr.Field.Value) void {
    std.debug.assert(count.* < fields.len);
    fields[count.*] = .{ .key = key, .value = value };
    count.* += 1;
}

pub fn nextSequence(sequence: u64) error{SequenceExhausted}!u64 {
    return std.math.add(u64, sequence, 1) catch error.SequenceExhausted;
}

pub fn requireIdentity(record: *const Record, peer: *const types.PeerId) Error!void {
    const public_key: keys.PublicKey = .{ .bytes = record.public_key };
    if (!types.PeerId.fromPublicKey(&public_key).eql(peer)) return error.IdentityMismatch;
}

test {
    _ = @import("enr_test.zig");
}
