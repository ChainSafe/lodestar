//! Every layer shares the node identity, distance arithmetic, endpoint addresses, and protocol
//! constants defined here.

const std = @import("std");

pub const NodeId = [32]u8;

pub const distance_max: u16 = 256;
pub const distance_count: usize = distance_max + 1;
pub const findnode_result_max: usize = 16;
pub const findnode_response_packets_max: u8 = 16;

/// Returns the log2 XOR distance, which is 0 for equal IDs and 256 when the top bits differ.
pub fn logDistance(left: *const NodeId, right: *const NodeId) u16 {
    for (left, right, 0..) |left_byte, right_byte, index| {
        const difference = left_byte ^ right_byte;
        if (difference == 0) continue;
        const leading: u16 = @intCast(@clz(difference));
        return @intCast(256 - index * 8 - leading);
    }
    return 0;
}

/// Returns true when `left` is strictly closer to `target` than `right`.
pub fn xorCloser(
    left: *const NodeId,
    right: *const NodeId,
    target: *const NodeId,
) bool {
    for (left, right, target) |left_byte, right_byte, target_byte| {
        const left_distance = left_byte ^ target_byte;
        const right_distance = right_byte ^ target_byte;
        if (left_distance != right_distance) return left_distance < right_distance;
    }
    return false;
}

pub const Address = @import("udp").Address;
pub const Mode = @import("udp").Sockets.Mode;

pub const Endpoint = struct {
    node_id: NodeId,
    address: Address,

    pub fn eql(self: *const Endpoint, other: *const Endpoint) bool {
        return std.mem.eql(u8, &self.node_id, &other.node_id) and self.address.eql(other.address);
    }
};

/// Why a datagram was not acted on. Admission pressure does not establish peer misconduct.
pub const RejectReason = enum {
    oversized_datagram,
    malformed_packet,
    malformed_message,
    invalid_record,
    unexpected_handshake,
    invalid_handshake,
    unexpected_challenge,
    request_too_large,
    unsolicited_response,
    invalid_response,
    duplicate_response,
    admission_limited,
    record_admission_limited,
};

/// Keeps `out[0..length]` ordered by XOR distance to `target`, dropping the farthest when full.
pub fn insertClosest(
    comptime T: type,
    comptime nodeIdOf: fn (*const T) *const NodeId,
    out: []T,
    length: usize,
    item: T,
    target: *const NodeId,
) usize {
    std.debug.assert(length <= out.len);
    var position: usize = 0;
    while (position < length and !xorCloser(nodeIdOf(&item), nodeIdOf(&out[position]), target)) {
        position += 1;
    }
    if (position == out.len) return length;
    const new_length = @min(length + 1, out.len);
    std.mem.copyBackwards(T, out[position + 1 .. new_length], out[position .. new_length - 1]);
    out[position] = item;
    return new_length;
}

test {
    _ = @import("types_test.zig");
}
