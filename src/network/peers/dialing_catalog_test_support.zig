const t = @import("types.zig");
const enr = @import("enr.zig");
const custody = @import("custody.zig");
const Catalog = @import("catalog.zig").Catalog;
const KeyPair = @import("../wire/keys.zig").KeyPair;
const address: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9001 } };
const local: t.PeerId = .{ .bytes = @splat(0) };

pub fn candidate(tag: u8, sync: u8) !enr.Candidate {
    var secret: [32]u8 = @splat(0);
    secret[31] = tag;
    const key = try KeyPair.fromSecretKey(&secret);
    const peer = t.PeerId.fromPublicKey(&key.publicKey());
    return .{ .peer = peer, .node_id = try custody.nodeId(&peer), .addresses = .{ address, .unspecified }, .address_count = 1, .hints = .{ .sequence = 1, .record_hash = @splat(0), .fork = .{ .digest = @splat(0), .next_version = @splat(0), .next_epoch = 0 }, .next_fork_digest = null, .attnets = null, .syncnets = sync, .custody_group_count = null } };
}
pub fn admit(c: *Catalog, peer: *const t.PeerId, index: u16, direction: t.Direction, now_ms: u64) Catalog.Admission {
    return c.admit(peer, &local, .{ .index = index, .generation = 1 }, &.{ .direction = direction, .endpoint = address, .now_ms = now_ms });
}
