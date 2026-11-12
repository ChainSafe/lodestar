const std = @import("std");
const reqresp = @import("reqresp/protocol.zig");
const meshsub = @import("gossipsub/protocol.zig");

pub const Kind = enum { reqresp, meshsub, identify };
pub const Protocol = union(Kind) {
    reqresp: reqresp.Protocol,
    meshsub: meshsub.Version,
    identify,

    pub const count = reqresp.Protocol.count + std.enums.values(meshsub.Version).len + 1;

    pub fn index(self: Protocol) u8 {
        return switch (self) {
            .reqresp => |which| @intFromEnum(which),
            .meshsub => |version| reqresp.Protocol.count + @intFromEnum(version),
            .identify => count - 1,
        };
    }

    pub fn fromIndex(value: u8) Protocol {
        std.debug.assert(value < count);
        if (value < reqresp.Protocol.count) return .{ .reqresp = @enumFromInt(value) };
        if (value == count - 1) return .identify;
        return .{ .meshsub = @enumFromInt(value - reqresp.Protocol.count) };
    }

    pub fn id(self: Protocol) []const u8 {
        return switch (self) {
            .identify => "/ipfs/id/1.0.0",
            .reqresp => |which| which.id(),
            .meshsub => |version| meshsub.ids[meshsub.ids.len - 1 - @intFromEnum(version)],
        };
    }

    pub fn fromId(id_bytes: []const u8) ?Protocol {
        if (std.mem.eql(u8, id_bytes, "/ipfs/id/1.0.0")) return .identify;
        if (reqresp.Protocol.fromId(id_bytes)) |which| return .{ .reqresp = which };
        for (meshsub.ids, 0..) |id_string, position| {
            if (std.mem.eql(u8, id_string, id_bytes)) return .{
                .meshsub = @enumFromInt(meshsub.ids.len - 1 - position),
            };
        }
        return null;
    }
};

comptime {
    std.debug.assert(meshsub.ids.len == std.enums.values(meshsub.Version).len);
}
