const std = @import("std");
const types = @import("types.zig");

/// Groups discovery contacts by IPv4 /24 or IPv6 /48, ignoring ports and interface scopes.
pub fn sameSubnet(left: types.Address, right: types.Address) bool {
    return switch (left) {
        .ip4 => |ip| right == .ip4 and std.mem.eql(u8, ip.octets[0..3], right.ip4.octets[0..3]),
        .ip6 => |ip| right == .ip6 and std.mem.eql(u8, ip.octets[0..6], right.ip6.octets[0..6]),
    };
}

/// A public candidate may be relayed by anyone. A candidate in a special scope may be relayed
/// only by a source in that same scope and address family.
pub fn relayAllowed(source: types.Address, candidate: types.Address) bool {
    const source_class = addressClass(source);
    const candidate_class = addressClass(candidate);
    if (source_class == .invalid or candidate_class == .invalid) return false;
    return switch (candidate_class) {
        .public => true,
        .private, .loopback, .link_local => source_class == candidate_class and
            std.meta.activeTag(source) == std.meta.activeTag(candidate),
        .invalid => false,
    };
}

const AddressClass = enum {
    invalid,
    public,
    private,
    loopback,
    link_local,
};

fn addressClass(address: types.Address) AddressClass {
    return switch (address) {
        .ip4 => |value| classifyIp4(value.octets),
        .ip6 => |value| classifyIp6(value.octets),
    };
}

fn classifyIp4(ip: [4]u8) AddressClass {
    if (ip[0] == 0 or ip[0] >= 224) return .invalid;
    if (ip[0] == 127) return .loopback;
    if (ip[0] == 169 and ip[1] == 254) return .link_local;
    if (ip[0] == 10 or
        (ip[0] == 100 and ip[1] >= 64 and ip[1] <= 127) or
        (ip[0] == 172 and ip[1] >= 16 and ip[1] <= 31) or
        (ip[0] == 192 and ip[1] == 168)) return .private;
    return .public;
}

fn classifyIp6(ip: [16]u8) AddressClass {
    if (std.mem.allEqual(u8, &ip, 0) or ip[0] == 0xff) return .invalid;
    if (std.mem.allEqual(u8, ip[0..15], 0) and ip[15] == 1) return .loopback;
    if (types.Address.isIp4Mapped(ip)) return .invalid;
    if (std.mem.allEqual(u8, ip[0..12], 0)) return .invalid;
    if (ip[0] == 0xfe and ip[1] & 0xc0 == 0x80) return .link_local;
    if (ip[0] & 0xfe == 0xfc or
        (ip[0] == 0xfe and ip[1] & 0xc0 == 0xc0)) return .private;
    return .public;
}

test {
    _ = @import("address_policy_test.zig");
}
