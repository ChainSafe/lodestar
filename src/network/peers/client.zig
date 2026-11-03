const std = @import("std");
const Metadata = @import("../identify/root.zig").Metadata;

pub const Client = enum { Lighthouse, Nimbus, Teku, Prysm, Lodestar, Grandine, Unknown };
pub const count = @typeInfo(Client).@"enum".fields.len;

pub fn kind(agent_version: []const u8) Client {
    const prefix = agent_version[0 .. std.mem.findScalar(u8, agent_version, '/') orelse agent_version.len];
    inline for (@typeInfo(Client).@"enum".fields) |field| {
        if (std.ascii.eqlIgnoreCase(prefix, field.name)) return @enumFromInt(field.value);
    }
    if (std.ascii.eqlIgnoreCase(prefix, "js-libp2p")) return .Lodestar;
    return .Unknown;
}

pub fn agent(metadata: *const ?Metadata) []const u8 {
    if (metadata.*) |*value| if (value.agent) |*text| return text.slice();
    return "unknown";
}

pub fn fromIdentify(metadata: *const ?Metadata) Client {
    return kind(agent(metadata));
}
