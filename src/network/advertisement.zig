const std = @import("std");
const d = @import("discv5");
const Address = d.types.Address;

pub const Endpoints = struct {
    ip4: ?[4]u8 = null,
    ip6: ?[16]u8 = null,
    udp: ?u16 = null,
    udp6: ?u16 = null,
    quic: ?u16 = null,
    quic6: ?u16 = null,
};
pub const Hints = struct {
    ip4: ?[4]u8 = null,
    ip6: ?[16]u8 = null,
    udp: ?u16 = null,
    udp6: ?u16 = null,
};
pub const Resolved = struct {
    endpoints: Endpoints = .{},
    observations: [2]d.AddressVotes.Policy = .{ .{}, .{} },
    quic_ports: [2]?u16 = .{ null, null },
};

/// Cached endpoints are hints. Only explicit fixed fields disable learning. An explicit IP
/// also fixes its discovery port, defaulting to the actual listener port.
pub fn resolve(hints: ?*const Hints, fixed: *const Endpoints, quic: *const [2]?Address, udp: *const [2]?Address) error{InvalidAdvertisement}!Resolved {
    var resolved: Resolved = .{};
    const initial = hints orelse &Hints{};
    inline for (.{ .{ "ip4", "udp", "quic" }, .{ "ip6", "udp6", "quic6" } }, 0..) |fields, family| resolve_family: {
        const ip_pin = @field(fixed, fields[0]);
        const port_pin = @field(fixed, fields[1]);
        const quic_pin = @field(fixed, fields[2]);
        if (port_pin == 0 or quic_pin == 0) return error.InvalidAdvertisement;
        if (quic_pin != null and quic[family] == null) return error.InvalidAdvertisement;
        const listener = udp[family] orelse {
            if (ip_pin != null or port_pin != null or quic_pin != null) return error.InvalidAdvertisement;
            break :resolve_family;
        };
        const bound_ip = if (family == 0) listener.ip4.octets else listener.ip6.octets;
        if (ip_pin) |ip| if (!validIp(ip)) return error.InvalidAdvertisement;
        const hint_ip = @field(initial, fields[0]);
        const use_hint = ip_pin == null and hint_ip != null and validIp(hint_ip.?);
        var ip = ip_pin orelse if (use_hint) hint_ip else null;
        if (ip == null and validIp(bound_ip)) {
            if (family == 1 and listener.ip6.interface != 0) return error.InvalidAdvertisement;
            ip = bound_ip;
        }
        resolved.observations[family] = .{ .enabled = ip_pin == null, .fixed_port = port_pin };
        resolved.quic_ports[family] = quic_pin orelse if (quic[family]) |address| address.port() else null;
        if (ip) |value| {
            @field(resolved.endpoints, fields[0]) = value;
            const hint_port = @field(initial, fields[1]);
            @field(resolved.endpoints, fields[1]) = port_pin orelse if (use_hint and hint_port != null and hint_port.? != 0) hint_port.? else listener.port();
            @field(resolved.endpoints, fields[2]) = resolved.quic_ports[family];
        }
    }
    return resolved;
}

pub fn validate(endpoints: Endpoints) error{InvalidAdvertisement}!void {
    if ((endpoints.udp != null or endpoints.quic != null) and endpoints.ip4 == null) return error.InvalidAdvertisement;
    if ((endpoints.udp6 != null or endpoints.quic6 != null) and endpoints.ip6 == null) return error.InvalidAdvertisement;
    inline for (.{ endpoints.udp, endpoints.udp6, endpoints.quic, endpoints.quic6 }) |port| if (port == 0) return error.InvalidAdvertisement;
    if (endpoints.ip4) |ip| if (!validIp(ip)) return error.InvalidAdvertisement;
    if (endpoints.ip6) |ip| if (!validIp(ip)) return error.InvalidAdvertisement;
}

fn validIp(ip: anytype) bool {
    const address: Address = if (ip.len == 4) .{ .ip4 = .{ .octets = ip, .port = 1 } } else .{ .ip6 = .{ .octets = ip, .port = 1 } };
    if (ip.len == 16 and ip[0] == 0xfe and ip[1] & 0xc0 == 0x80) return false;
    return address.isUsable() and d.address_policy.relayAllowed(address, address);
}

test {
    _ = @import("advertisement_test.zig");
}
