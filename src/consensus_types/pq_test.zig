const std = @import("std");
const pq = @import("pq.zig");
const gloas = @import("gloas.zig");

test "PQ preserves generalized indices across removed fields" {
    inline for (.{ "current_sync_committee", "next_sync_committee" }) |field| {
        try std.testing.expect(comptime !pq.BeaconState.hasField(field));
    }
    inline for (gloas.BeaconState.fields) |field| {
        if (comptime !pq.BeaconState.hasField(field.name)) continue;
        try std.testing.expectEqual(comptime gloas.BeaconState.getFieldGindex(field.name), comptime pq.BeaconState.getFieldGindex(field.name));
    }
    inline for (gloas.BeaconBlockBody.fields) |field| {
        if (comptime !pq.BeaconBlockBody.hasField(field.name)) continue;
        try std.testing.expectEqual(comptime gloas.BeaconBlockBody.getFieldGindex(field.name), comptime pq.BeaconBlockBody.getFieldGindex(field.name));
    }
    try std.testing.expectEqual(comptime gloas.Attestation.getFieldGindex("committee_bits"), comptime pq.Attestation.getFieldGindex("committee_bits"));
}
