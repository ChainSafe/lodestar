const std = @import("std");
const constants = @import("constants.zig");

const assert = std.debug.assert;
const sha256 = @import("sha256.zig");

pub const prefix = "/eth2/";
pub const suffix = "/ssz_snappy";
pub const digest_hex_len: usize = 8;
/// The longest supported gossip name is `sync_committee_contribution_and_proof`.
pub const name_max_len: usize = "sync_committee_contribution_and_proof".len;
pub const topic_max_len: usize = prefix.len + digest_hex_len + 1 + name_max_len + suffix.len;

pub const Kind = enum(u8) {
    beacon_block,
    beacon_aggregate_and_proof,
    beacon_attestation,
    proposer_slashing,
    attester_slashing,
    voluntary_exit,
    sync_committee_contribution_and_proof,
    sync_committee,
    light_client_finality_update,
    light_client_optimistic_update,
    bls_to_execution_change,
    blob_sidecar,
    data_column_sidecar,
    execution_payload,
    payload_attestation_message,
    execution_payload_bid,
    proposer_preferences,

    pub fn countMax(self: Kind) u16 {
        return switch (self) {
            .beacon_attestation => 64,
            .sync_committee => 4,
            .blob_sidecar, .data_column_sidecar => 128,
            else => 1,
        };
    }
};

pub const Name = struct {
    kind: Kind,
    subnet: u16 = 0,

    pub fn parse(name: []const u8) ?Name {
        if (name.len > name_max_len) return null;
        inline for (@typeInfo(Kind).@"enum".fields) |field| {
            const kind: Kind = @enumFromInt(field.value);
            if (comptime kind.countMax() == 1) {
                if (std.mem.eql(u8, name, field.name)) return .{ .kind = kind };
            } else if (std.mem.startsWith(u8, name, field.name ++ "_")) {
                const decimal = name[field.name.len + 1 ..];
                if (decimal.len == 0 or decimal.len > 3 or (decimal.len > 1 and decimal[0] == '0')) return null;
                for (decimal) |char| if (!std.ascii.isDigit(char)) return null;
                const subnet = std.fmt.parseInt(u16, decimal, 10) catch return null;
                if (subnet >= kind.countMax()) return null;
                return .{ .kind = kind, .subnet = subnet };
            }
        }
        return null;
    }
};

pub const Canonical = struct { digest: ForkDigest, name: Name };

pub fn buildCanonical(value: Canonical, out: *[topic_max_len]u8) []const u8 {
    assert(value.name.subnet < value.name.kind.countMax());
    var buffer: [name_max_len]u8 = undefined;
    const name = if (value.name.kind.countMax() == 1) @tagName(value.name.kind) else std.fmt.bufPrint(&buffer, "{s}_{d}", .{ @tagName(value.name.kind), value.name.subnet }) catch unreachable;
    return build(value.digest, name, out);
}

pub fn parseCanonical(wire: []const u8) ?Canonical {
    const parsed = parse(wire) orelse return null;
    const hex = std.fmt.bytesToHex(parsed.digest, .lower);
    if (!std.mem.eql(u8, &hex, wire[prefix.len..][0..digest_hex_len])) return null;
    return .{ .digest = parsed.digest, .name = Name.parse(parsed.name) orelse return null };
}

pub const ForkDigest = [4]u8;

pub const Parsed = struct {
    digest: ForkDigest,
    name: []const u8,
};

/// Writes `/eth2/<fork-digest-hex>/<name>/ssz_snappy` into `out` and returns it.
pub fn build(digest: ForkDigest, name: []const u8, out: []u8) []const u8 {
    assert(name.len <= name_max_len);
    const hex = std.fmt.bytesToHex(digest, .lower);
    var len: usize = 0;
    len = append(out, len, prefix);
    len = append(out, len, &hex);
    len = append(out, len, "/");
    len = append(out, len, name);
    len = append(out, len, suffix);
    return out[0..len];
}

fn append(out: []u8, at: usize, part: []const u8) usize {
    assert(at + part.len <= out.len);
    @memcpy(out[at..][0..part.len], part);
    return at + part.len;
}

/// Splits a topic string into its fork digest and name, or null when it does not
/// match `/eth2/<8 hex>/<name>/ssz_snappy`.
pub fn parse(topic: []const u8) ?Parsed {
    if (topic.len < prefix.len + digest_hex_len + 1 + suffix.len) return null;
    if (!std.mem.startsWith(u8, topic, prefix)) return null;
    if (!std.mem.endsWith(u8, topic, suffix)) return null;
    const after_prefix = topic[prefix.len..];
    if (after_prefix.len < digest_hex_len + 1) return null;
    if (after_prefix[digest_hex_len] != '/') return null;
    var digest: ForkDigest = undefined;
    _ = std.fmt.hexToBytes(&digest, after_prefix[0..digest_hex_len]) catch return null;
    const name = topic[prefix.len + digest_hex_len + 1 .. topic.len - suffix.len];
    if (name.len == 0 or name.len > name_max_len) return null;
    return .{ .digest = digest, .name = name };
}

pub const MessageId = [constants.message_id_length]u8;

pub const MessageIdPolicy = struct {
    /// Topics with this digest use Phase0 IDs; all other topics use Altair IDs.
    phase0_digest: ?ForkDigest = null,

    fn isPhase0(self: MessageIdPolicy, topic: []const u8) bool {
        const phase0_digest = self.phase0_digest orelse return false;
        const parsed = parse(topic) orelse return false;
        return std.mem.eql(u8, &phase0_digest, &parsed.digest);
    }
};

fn digestWithDomain(
    domain: [4]u8,
    topic: []const u8,
    payload: []const u8,
    policy: MessageIdPolicy,
) MessageId {
    var header: [12]u8 = undefined;
    header[0..4].* = domain;
    std.mem.writeInt(u64, header[4..12], @intCast(topic.len), .little);
    const hash = if (policy.isPhase0(topic)) sha256.digest(&domain, &.{}, payload) else sha256.digest(&header, topic, payload);
    return hash[0..constants.message_id_length].*;
}

/// Message id over the snappy-decompressed payload (the valid-snappy case).
pub fn validMessageId(
    topic: []const u8,
    decompressed: []const u8,
    policy: MessageIdPolicy,
) MessageId {
    return digestWithDomain(constants.MESSAGE_DOMAIN_VALID_SNAPPY, topic, decompressed, policy);
}

/// Message id over the raw message data when it does not snappy-decompress.
pub fn invalidMessageId(topic: []const u8, raw: []const u8, policy: MessageIdPolicy) MessageId {
    return digestWithDomain(constants.MESSAGE_DOMAIN_INVALID_SNAPPY, topic, raw, policy);
}

// Independently derived with Python hashlib from consensus-specs v1.7.0-alpha.11
// specs/{phase0,altair}/p2p-interface.md, GossipSub message-id formulas.

test {
    _ = @import("topic_test.zig");
}
