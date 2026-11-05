//! A PendingResponse is a PONG or NODES reply staged for sending. NODES fragments are cut by
//! encoded size, so up to sixteen records go out in as few packets as fit.

const std = @import("std");
const enr = @import("identity/enr.zig");
const types = @import("types.zig");
const constants = @import("wire/constants.zig");
const message = @import("wire/message.zig");

const PendingResponse = @This();

pub const Error = message.Error;

const Nodes = struct {
    request_id: message.RequestId,
    packet_count: u8,
};

pub const RawRecords = [types.findnode_result_max][]const u8;

peer: types.Endpoint = undefined,
records: [types.findnode_result_max]enr.Record = undefined,
boundaries: [types.findnode_response_packets_max + 1]u8 = undefined,
encoded: u8 = 0,
body: union(enum) {
    none,
    pong: message.Pong,
    nodes: Nodes,
} = .none,

/// The returned NODES message borrows `raw` for its record slices.
pub fn next(self: *const PendingResponse, raw: *RawRecords) ?message.Message {
    return switch (self.body) {
        .none => null,
        .pong => |value| if (self.encoded == 0) .{ .pong = value } else null,
        .nodes => |value| blk: {
            if (self.encoded == value.packet_count) break :blk null;
            std.debug.assert(self.encoded < value.packet_count);
            const start = self.boundaries[self.encoded];
            const end = self.boundaries[self.encoded + 1];
            std.debug.assert(start <= end);
            std.debug.assert(end <= self.records.len);
            break :blk .{ .nodes = .{
                .request_id = value.request_id,
                .total = value.packet_count,
                .enrs = sliceRecords(self.records[start..end], raw),
            } };
        },
    };
}

pub fn advance(self: *PendingResponse) void {
    std.debug.assert(!self.complete());
    self.encoded += 1;
}

pub fn complete(self: *const PendingResponse) bool {
    return switch (self.body) {
        .none => true,
        .pong => self.encoded == 1,
        .nodes => |value| self.encoded == value.packet_count,
    };
}

pub fn preparePong(
    response: *PendingResponse,
    peer: types.Endpoint,
    request_id: message.RequestId,
    local_enr_sequence: u64,
) void {
    response.peer = peer;
    response.encoded = 0;
    response.body = .{ .pong = switch (peer.address) {
        .ip4 => |address| .{
            .request_id = request_id,
            .enr_sequence = local_enr_sequence,
            .recipient_ip = .{ .ip4 = address.octets },
            .recipient_port = address.port,
        },
        .ip6 => |address| .{
            .request_id = request_id,
            .enr_sequence = local_enr_sequence,
            .recipient_ip = .{ .ip6 = address.octets },
            .recipient_port = address.port,
        },
    } };
}

/// Cuts `records[0..record_count]` into packets. The caller fills `records` in place first.
pub fn prepareNodes(
    response: *PendingResponse,
    peer: types.Endpoint,
    request_id: message.RequestId,
    record_count: usize,
) Error!void {
    if (record_count > types.findnode_result_max) return Error.InvalidMessage;
    response.peer = peer;
    response.encoded = 0;
    if (record_count == 0) {
        response.boundaries[0] = 0;
        response.boundaries[1] = 0;
        setNodes(response, request_id, 1);
        return;
    }
    var raw_records: RawRecords = undefined;
    const raw = sliceRecords(response.records[0..record_count], &raw_records);

    var packet_count: u8 = 0;
    var record_start: usize = 0;
    var encoded: [constants.ordinary_plaintext_size_max]u8 = undefined;
    while (record_start < record_count) {
        std.debug.assert(packet_count < types.findnode_response_packets_max);
        response.boundaries[packet_count] = @intCast(record_start);
        var record_end = record_start;
        while (record_end < record_count) {
            const candidate = message.Message{
                .nodes = .{
                    .request_id = request_id,
                    // Counts 1 through 16 have the same one-byte RLP width.
                    .total = types.findnode_response_packets_max,
                    .enrs = raw[record_start .. record_end + 1],
                },
            };
            _ = candidate.encode(&encoded) catch |err| switch (err) {
                message.Error.InvalidMessage => break,
                else => return err,
            };
            record_end += 1;
        }
        if (record_end == record_start) return Error.InvalidMessage;
        packet_count += 1;
        record_start = record_end;
    }
    response.boundaries[packet_count] = @intCast(record_count);
    setNodes(response, request_id, packet_count);
}

fn sliceRecords(records: []const enr.Record, raw: *RawRecords) []const []const u8 {
    for (records, raw[0..records.len]) |*record, *slice| slice.* = record.slice();
    return raw[0..records.len];
}

fn setNodes(response: *PendingResponse, request_id: message.RequestId, packet_count: u8) void {
    std.debug.assert(packet_count > 0);
    std.debug.assert(packet_count <= types.findnode_response_packets_max);
    response.body = .{ .nodes = .{
        .request_id = request_id,
        .packet_count = packet_count,
    } };
}

comptime {
    std.debug.assert(@sizeOf(PendingResponse) <= 8 * 1_024);
}

test {
    _ = @import("pending_response_test.zig");
}
