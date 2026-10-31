const std = @import("std");
const heze = @import("heze.zig");
const gloas = @import("gloas.zig");

test "Heze preserves generalized indices across removed fields" {
    inline for (.{ "eth1_data", "eth1_data_votes", "eth1_deposit_index", "deposit_requests_start_index" }) |field| {
        try std.testing.expect(comptime !heze.BeaconState.hasField(field));
    }
    inline for (heze.BeaconState.fields) |field| {
        try std.testing.expectEqual(comptime gloas.BeaconState.getFieldGindex(field.name), comptime heze.BeaconState.getFieldGindex(field.name));
    }
    try std.testing.expect(comptime !heze.BeaconBlockBody.hasField("eth1_data"));
    try std.testing.expect(comptime !heze.BeaconBlockBody.hasField("deposits"));
    inline for (heze.BeaconBlockBody.fields) |field| {
        try std.testing.expectEqual(comptime gloas.BeaconBlockBody.getFieldGindex(field.name), comptime heze.BeaconBlockBody.getFieldGindex(field.name));
    }
    inline for (gloas.ExecutionPayloadBid.fields) |field| {
        try std.testing.expectEqual(comptime gloas.ExecutionPayloadBid.getFieldGindex(field.name), comptime heze.ExecutionPayloadBid.getFieldGindex(field.name));
    }
}

test "Heze inclusion list request encodes slot root and committee bits" {
    var request = heze.InclusionListsByIndicesRequest.default_value;
    request.slot = 123;
    request.dependent_root = @splat(0x42);
    try request.indices.set(0, true);
    try request.indices.set(15, true);
    var bytes: [42]u8 = undefined;
    try std.testing.expectEqual(42, heze.InclusionListsByIndicesRequest.serializeIntoBytes(&request, &bytes));
    try std.testing.expectEqual(123, std.mem.readInt(u64, bytes[0..8], .little));
    try std.testing.expectEqualSlices(u8, &request.dependent_root, bytes[8..40]);
    try std.testing.expectEqualSlices(u8, &.{ 1, 128 }, bytes[40..]);
    var decoded = heze.InclusionListsByIndicesRequest.default_value;
    try heze.InclusionListsByIndicesRequest.deserializeFromBytes(&bytes, &decoded);
    try std.testing.expect(heze.InclusionListsByIndicesRequest.equals(&request, &decoded));
    try std.testing.expectError(error.InvalidSize, heze.InclusionListsByIndicesRequest.deserializeFromBytes(bytes[0..41], &decoded));
}
