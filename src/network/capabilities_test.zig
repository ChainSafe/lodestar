const std = @import("std");
const capabilities = @import("capabilities.zig");
const Protocol = @import("protocol.zig").Protocol;
const rr = @import("reqresp/protocol.zig");
const ForkSeq = @import("config").ForkSeq;
const protocol_mod = @import("gossipsub/protocol.zig");

test "capabilities iteration snapshots sparse membership and stays exhausted" {
    var set: capabilities.Set = .initEmpty();
    var empty = set.iterator();
    try std.testing.expectEqual(null, empty.next());
    set.insert(.identify);
    set.insert(.{ .meshsub = .v1_2 });
    set.insert(.{ .reqresp = .ping_v1 });
    var iterator = set.iterator();
    set.insert(.{ .reqresp = .status_v1 });
    for ([_]Protocol{ .{ .reqresp = .ping_v1 }, .{ .meshsub = .v1_2 }, .identify }) |expected| {
        try std.testing.expectEqualDeep(expected, iterator.next().?);
    }
    try std.testing.expectEqual(null, iterator.next());
    try std.testing.expectEqual(null, iterator.next());
    try std.testing.expectEqual(4, set.count());
    try std.testing.expectEqual(null, empty.next());
}

test "capabilities iteration returns every protocol exactly once" {
    var set: capabilities.Set = .initEmpty();
    for (std.enums.values(rr.Protocol)) |which| set.insert(.{ .reqresp = which });
    for (std.enums.values(protocol_mod.Version)) |version| set.insert(.{ .meshsub = version });
    set.insert(.identify);
    var iterator = set.iterator();
    var seen: capabilities.Set = .initEmpty();
    for (0..capabilities.protocol_count) |_| {
        const protocol = iterator.next().?;
        try std.testing.expect(!seen.contains(protocol));
        try std.testing.expectEqualDeep(protocol, Protocol.fromId(Protocol.fromIndex(protocol.index()).id()).?);
        seen.insert(protocol);
    }
    try std.testing.expectEqual(null, iterator.next());
    try std.testing.expectEqualDeep(set, seen);
}

test "capabilities fork sets match every implemented host protocol in both directions" {
    const common = [_]rr.Protocol{ .goodbye_v1, .ping_v1, .metadata_v3, .blocks_by_range_v2, .blocks_by_root_v2 };
    const light_client = [_]rr.Protocol{ .light_client_bootstrap_v1, .light_client_updates_by_range_v1, .light_client_finality_update_v1, .light_client_optimistic_update_v1 };
    for ([_]ForkSeq{ .phase0, .altair, .bellatrix, .capella, .deneb, .electra, .fulu, .gloas }) |fork| {
        for ([_]bool{ false, true }) |serve| {
            const active = try capabilities.forFork(fork, serve, &.{ .v1_2, .v1_1 });
            var expected: capabilities.Set = .initEmpty();
            for (common) |protocol| expected.insert(.{ .reqresp = protocol });
            if (fork.lt(.altair)) expected.insert(.{ .reqresp = .metadata_v1 });
            if (fork.lt(.fulu)) {
                expected.insert(.{ .reqresp = .status_v1 });
                expected.insert(.{ .reqresp = .metadata_v2 });
            } else {
                for ([_]rr.Protocol{ .status_v2, .blocks_by_head_v1, .data_column_sidecars_by_range_v1, .data_column_sidecars_by_root_v1 }) |protocol| expected.insert(.{ .reqresp = protocol });
            }
            if (fork.gte(.deneb)) {
                expected.insert(.{ .reqresp = .blob_sidecars_by_range_v1 });
                expected.insert(.{ .reqresp = .blob_sidecars_by_root_v1 });
            }
            if (fork.gte(.gloas)) {
                expected.insert(.{ .reqresp = .execution_payload_envelopes_by_range_v1 });
                expected.insert(.{ .reqresp = .execution_payload_envelopes_by_root_v1 });
            }
            expected.insert(.{ .meshsub = .v1_2 });
            expected.insert(.{ .meshsub = .v1_1 });
            var receive = expected;
            var request = expected;
            if (fork.gte(.fulu)) receive.insert(.{ .reqresp = .status_v1 });
            if (fork.gte(.altair)) for (light_client) |protocol| {
                request.insert(.{ .reqresp = protocol });
                if (serve) receive.insert(.{ .reqresp = protocol });
            };
            for (std.enums.values(rr.Protocol)) |protocol| {
                const id: Protocol = .{ .reqresp = protocol };
                try std.testing.expectEqual(receive.contains(id), active.receive.contains(id));
                try std.testing.expectEqual(request.contains(id), active.request.contains(id));
            }
            try std.testing.expectEqual(receive.count(), active.receive.count());
            try std.testing.expectEqual(request.count(), active.request.count());
            try std.testing.expect(active.receive.contains(.{ .meshsub = .v1_2 }));
            try std.testing.expect(active.request.contains(.{ .meshsub = .v1_1 }));
            try std.testing.expect(!active.receive.contains(.{ .meshsub = .v1_0 }));
        }
    }
    const fulu = try capabilities.forFork(.fulu, true, &.{.v1_0});
    try std.testing.expectEqual(17, fulu.receive.count());
    const active = try capabilities.forFork(.fulu, false, &.{ .v1_2, .v1_1 });
    try std.testing.expect(!active.receive.contains(.{ .reqresp = .light_client_bootstrap_v1 }));
    try std.testing.expect(active.request.contains(.{ .reqresp = .light_client_bootstrap_v1 }));
    try std.testing.expect(active.receive.contains(.{ .reqresp = .status_v2 }));
    try std.testing.expect(active.receive.contains(.{ .reqresp = .status_v1 }));
    try std.testing.expect(!active.request.contains(.{ .reqresp = .status_v1 }));
}

test "capabilities reject invalid meshsub preferences" {
    try std.testing.expectError(error.InvalidCapabilities, capabilities.forFork(.fulu, true, &.{}));
    try std.testing.expectError(error.InvalidCapabilities, capabilities.forFork(.fulu, true, &.{ .v1_2, .v1_2 }));
    try std.testing.expectError(error.InvalidCapabilities, capabilities.forFork(.fulu, true, &.{ .v1_2, .v1_1, .v1_0, .v1_2 }));
}
