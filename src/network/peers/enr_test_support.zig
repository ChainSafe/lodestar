const std = @import("std");
const d = @import("discv5");
const adapter = @import("enr.zig");
const vectors = @import("enr_vectors.zig").vectors;

pub fn signingKey() !d.identity.crypto.KeyPair {
    return d.identity.crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{1}));
}

pub fn advertisement() adapter.LocalAdvertisement {
    return .{
        .fork = .{ .digest = .{ 1, 2, 3, 4 }, .next_version = .{ 5, 0, 0, 0 }, .next_epoch = std.math.maxInt(u64) },
        .ip4 = .{ 127, 0, 0, 1 },
        .udp = 9000,
        .quic = 9001,
        .next_fork_digest = .{ 9, 10, 11, 12 },
        .attnets = .{ 1, 0, 0, 0, 0, 0, 0, 128 },
        .syncnets = 5,
        .custody_group_count = 4,
    };
}

pub fn changedRecord(name: []const u8, replacement: ?d.identity.enr.Field.Value) !d.identity.enr.Record {
    const record = try d.identity.enr.Record.initText(vectors[0].text);
    const key = try signingKey();
    var fields: [11]d.identity.enr.Field = undefined;
    var count: usize = 0;
    for ([_][]const u8{ "attnets", "cgc", "eth2", "id", "ip", "nfd", "quic", "secp256k1", "syncnets", "udp" }) |field_name| {
        const value = if (std.mem.eql(u8, name, field_name)) replacement orelse continue else d.identity.enr.Field.Value{ .raw = (try record.field(field_name)).? };
        fields[count] = .{ .key = field_name, .value = value };
        count += 1;
    }
    if (std.mem.eql(u8, name, "x-test")) {
        fields[count] = .{ .key = name, .value = replacement.? };
        count += 1;
    }
    return d.identity.enr.Record.createFields(&key, 8, fields[0..count]);
}
