const std = @import("std");
const Protocol = @import("protocol.zig").Protocol;
const reqresp = @import("reqresp/protocol.zig");
const ForkSeq = @import("config").ForkSeq;
const Version = @import("gossipsub/protocol.zig").Version;

pub const protocol_count = Protocol.count;
const Bits = std.meta.Int(.unsigned, protocol_count);

pub const Set = struct {
    bits: Bits = 0,

    pub fn initEmpty() Set {
        return .{};
    }

    pub fn insert(self: *Set, protocol: Protocol) void {
        self.bits |= bit(protocol);
    }

    pub fn contains(self: Set, protocol: Protocol) bool {
        return self.bits & bit(protocol) != 0;
    }

    pub fn count(self: Set) u8 {
        return @popCount(self.bits);
    }

    pub fn iterator(self: Set) Iterator {
        return .{ .remaining = self.bits };
    }

    pub const Iterator = struct {
        remaining: Bits,

        pub fn next(self: *Iterator) ?Protocol {
            if (self.remaining == 0) return null;
            const index = @ctz(self.remaining);
            self.remaining &= self.remaining - 1;
            return Protocol.fromIndex(index);
        }
    };

    fn bit(protocol: Protocol) Bits {
        const index: std.math.Log2Int(Bits) = @intCast(protocol.index());
        return @as(Bits, 1) << index;
    }
};

pub const Directional = struct { receive: Set, request: Set };

/// Produces the implemented host subset. Phase0 block v1 is not implemented.
/// Metadata3 serving requires a real configured local custody count even before Fulu.
pub fn forFork(fork: ForkSeq, serve_light_clients: bool, meshsub_versions: []const Version) error{InvalidCapabilities}!Directional {
    if (meshsub_versions.len == 0 or meshsub_versions.len > 3) return error.InvalidCapabilities;
    var common: Set = .initEmpty();
    for (meshsub_versions) |version| {
        const protocol: Protocol = .{ .meshsub = version };
        if (common.contains(protocol)) return error.InvalidCapabilities;
        common.insert(protocol);
    }
    for ([_]reqresp.Protocol{ .ping_v1, .goodbye_v1, .metadata_v3, .blocks_by_range_v2, .blocks_by_root_v2 }) |protocol| common.insert(.{ .reqresp = protocol });
    if (fork.lt(.altair)) common.insert(.{ .reqresp = .metadata_v1 });
    if (fork.lt(.fulu)) {
        common.insert(.{ .reqresp = .status_v1 });
        common.insert(.{ .reqresp = .metadata_v2 });
    } else {
        for ([_]reqresp.Protocol{ .status_v2, .blocks_by_head_v1, .data_column_sidecars_by_range_v1, .data_column_sidecars_by_root_v1 }) |protocol| common.insert(.{ .reqresp = protocol });
    }
    if (fork.gte(.deneb)) {
        common.insert(.{ .reqresp = .blob_sidecars_by_range_v1 });
        common.insert(.{ .reqresp = .blob_sidecars_by_root_v1 });
    }
    if (fork.gte(.gloas)) {
        common.insert(.{ .reqresp = .execution_payload_envelopes_by_range_v1 });
        common.insert(.{ .reqresp = .execution_payload_envelopes_by_root_v1 });
    }
    var active: Directional = .{ .receive = common, .request = common };
    // Control applies the established peer's fixed revalidation deadline to old Status bytes.
    if (fork.gte(.fulu)) active.receive.insert(.{ .reqresp = .status_v1 });
    if (fork.gte(.altair)) for ([_]reqresp.Protocol{ .light_client_bootstrap_v1, .light_client_updates_by_range_v1, .light_client_finality_update_v1, .light_client_optimistic_update_v1 }) |protocol| {
        active.request.insert(.{ .reqresp = protocol });
        if (serve_light_clients) active.receive.insert(.{ .reqresp = protocol });
    };
    return active;
}

/// Compose with forFork for full-host startup and local updates when Identify is configured.
pub fn withIdentify(active: Directional) Directional {
    var result = active;
    result.receive.insert(.identify);
    result.request.insert(.identify);
    return result;
}

test {
    _ = @import("capabilities_test.zig");
}
