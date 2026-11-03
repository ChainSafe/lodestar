//! Bounded endpoint observations from authenticated PONGs matched to selected observation probes.
//! Distinct node IDs and IPv4 /24 or IPv6 /48 sources must agree; neither proves operator independence.
const std = @import("std");
const address_policy = @import("address_policy.zig");
const types = @import("types.zig");
const message = @import("wire/message.zig");
const CallTable = @import("CallTable.zig");

pub const capacity = 200;
pub const quorum = 10;
pub const sample_target = 2 * quorum;
pub const lifetime_ms: u64 = 300_000;
pub const probe_interval_ms: u64 = 1_000;
pub const Policy = struct { enabled: bool = false, fixed_port: ?u16 = null };

const Entry = struct {
    peer: types.Endpoint,
    expires_ms: u64,
    observed: ?types.Address = null,
    attempt: ?CallTable.Handle = null,
};
const Table = struct {
    policy: Policy = .{},
    entries: [capacity]?Entry = @splat(null),
};
const AddressVotes = @This();
tables: [2]Table = .{ .{}, .{} },

pub fn init(self: *AddressVotes, policy: [2]Policy) void {
    self.* = .{};
    for (&self.tables, policy) |*table, value| {
        std.debug.assert(value.fixed_port == null or value.fixed_port.? != 0);
        table.policy = value;
    }
}

pub fn count(self: *const AddressVotes, family: usize, now_ms: u64) usize {
    var live: usize = 0;
    for (&self.tables[family].entries) |*slot| if (slot.*) |entry| {
        if (entry.expires_ms > now_ms and entry.observed != null) live += 1;
    };
    return live;
}

pub fn needsSample(self: *const AddressVotes, family: usize, now_ms: u64) bool {
    return self.tables[family].policy.enabled and self.count(family, now_ms) < sample_target;
}

pub fn canProbe(self: *const AddressVotes, peer: *const types.Endpoint, now_ms: u64) bool {
    const table = &self.tables[index(peer.address)];
    if (!table.policy.enabled) return false;
    for (&table.entries) |*slot| if (slot.*) |*entry| {
        if (entry.expires_ms > now_ms and collides(&entry.peer, peer)) return false;
    };
    return true;
}

pub fn attempted(self: *AddressVotes, peer: *const types.Endpoint, handle: CallTable.Handle, now_ms: u64) void {
    std.debug.assert(self.canProbe(peer, now_ms));
    self.replace(peer, .{ .peer = peer.*, .attempt = handle, .expires_ms = now_ms +| lifetime_ms }, now_ms);
}

pub fn localFailure(self: *AddressVotes, peer: *const types.Endpoint, handle: CallTable.Handle) void {
    for (&self.tables[index(peer.address)].entries) |*slot| if (slot.*) |entry| {
        if (entry.observed == null and std.meta.eql(entry.attempt, handle) and entry.peer.eql(peer)) slot.* = null;
    };
}

/// Only the owner of authenticated, matched response events may submit observations.
pub fn observe(self: *AddressVotes, peer: *const types.Endpoint, handle: CallTable.Handle, pong: *const message.Pong, now_ms: u64) ?types.Address {
    const table = &self.tables[index(peer.address)];
    if (!table.policy.enabled) return null;
    const observation = for (&table.entries) |*slot| {
        if (slot.*) |*entry| {
            if (entry.expires_ms > now_ms and std.meta.eql(entry.attempt, handle) and entry.peer.eql(peer)) break entry;
        }
    } else return null;
    observation.attempt = null;
    if (pong.recipient_port == 0) return null;
    const observed: types.Address = switch (pong.recipient_ip) {
        .ip4 => |ip| .{ .ip4 = .{ .octets = ip, .port = table.policy.fixed_port orelse pong.recipient_port } },
        .ip6 => |ip| .{ .ip6 = .{ .octets = ip, .port = table.policy.fixed_port orelse pong.recipient_port } },
    };
    if (index(observed) != index(peer.address) or !observed.isUsable() or !address_policy.relayAllowed(peer.address, observed)) return null;
    if (observed == .ip6 and observed.ip6.octets[0] == 0xfe and observed.ip6.octets[1] & 0xc0 == 0x80) return null;
    observation.observed = observed;
    observation.expires_ms = now_ms +| lifetime_ms;
    var live: usize = 0;
    var matching: usize = 0;
    for (&table.entries) |*slot| if (slot.*) |entry| {
        if (entry.expires_ms <= now_ms) continue;
        if (entry.observed) |address| {
            live += 1;
            if (address.eql(observed)) matching += 1;
        }
    };
    return if (matching >= quorum and 3 * matching > 2 * live) observed else null;
}

fn replace(self: *AddressVotes, peer: *const types.Endpoint, value: Entry, now_ms: u64) void {
    const table = &self.tables[index(peer.address)];
    var available: ?usize = null;
    var oldest: usize = 0;
    var oldest_expiry: u64 = std.math.maxInt(u64);
    for (&table.entries, 0..) |*slot, i| {
        if (slot.*) |*entry| {
            if (entry.expires_ms <= now_ms or collides(&entry.peer, peer)) {
                slot.* = null;
            } else if (entry.expires_ms < oldest_expiry) {
                oldest = i;
                oldest_expiry = entry.expires_ms;
            }
        }
        if (slot.* == null and available == null) available = i;
    }
    table.entries[available orelse oldest] = value;
}

fn collides(a: *const types.Endpoint, b: *const types.Endpoint) bool {
    if (std.mem.eql(u8, &a.node_id, &b.node_id)) return true;
    return address_policy.sameSubnet(a.address, b.address);
}

fn index(address: types.Address) usize {
    return if (address == .ip4) 0 else 1;
}

test {
    _ = @import("address_votes_test.zig");
}
