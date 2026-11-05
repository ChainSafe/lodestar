//! Decode input and scratch must not overlap. Results borrow both until reuse.
//! Every decode may overwrite scratch, including a rejected message.

const std = @import("std");
const constants = @import("constants.zig");
const rlp = @import("rlp.zig");
const types = @import("../types.zig");

pub const Error = rlp.Error || error{
    InvalidMessage,
    UnsupportedMessage,
};

pub const RequestId = struct {
    bytes: [8]u8,
    length: u8,

    pub fn init(bytes: []const u8) Error!RequestId {
        if (bytes.len > 8) return error.InvalidMessage;
        var request_id = RequestId{
            .bytes = [_]u8{0} ** 8,
            .length = @intCast(bytes.len),
        };
        @memcpy(request_id.bytes[0..bytes.len], bytes);
        return request_id;
    }

    pub fn slice(self: *const RequestId) []const u8 {
        std.debug.assert(self.length <= self.bytes.len);
        return self.bytes[0..self.length];
    }
};

pub const RecipientIp = union(enum) {
    ip4: [4]u8,
    ip6: [16]u8,
};

pub const Ping = struct {
    request_id: RequestId,
    enr_sequence: u64,
};

pub const Pong = struct {
    request_id: RequestId,
    enr_sequence: u64,
    recipient_ip: RecipientIp,
    recipient_port: u16,
};

pub const FindNode = struct {
    request_id: RequestId,
    distances: []const u16,
};

pub const Nodes = struct {
    request_id: RequestId,
    total: u64,
    enrs: []const []const u8,
};

pub const TalkRequest = struct {
    request_id: RequestId,
    protocol: []const u8,
    request: []const u8,
};

pub const TalkResponse = struct {
    request_id: RequestId,
    response: []const u8,
};

pub const DecodeScratch = struct {
    distances: [types.distance_count]u16 = undefined,
    enrs: [types.findnode_result_max][]const u8 = undefined,
};

pub const Message = union(enum) {
    ping: Ping,
    pong: Pong,
    find_node: FindNode,
    nodes: Nodes,
    talk_request: TalkRequest,
    talk_response: TalkResponse,

    pub fn encode(self: *const Message, out: []u8) Error![]u8 {
        var encoded: [constants.ordinary_plaintext_size_max]u8 = undefined;
        encoded[0] = self.code();
        var writer = rlp.Writer.init(encoded[1..]);
        encodePayload(self, &writer) catch |err| switch (err) {
            error.BufferTooSmall => return error.InvalidMessage,
            else => return err,
        };
        const encoded_length = writer.bytes().len + 1;
        std.debug.assert(encoded_length <= encoded.len);
        if (out.len < encoded_length) return error.BufferTooSmall;
        @memcpy(out[0..encoded_length], encoded[0..encoded_length]);
        return out[0..encoded_length];
    }

    pub fn decode(data: []const u8, scratch: *DecodeScratch) Error!Message {
        if (data.len == 0) return error.InvalidMessage;
        if (data.len > constants.ordinary_plaintext_size_max) return error.InvalidMessage;
        return switch (data[0]) {
            0x01 => .{ .ping = try decodePing(data) },
            0x02 => .{ .pong = try decodePong(data) },
            0x03 => .{ .find_node = try decodeFindNode(data, scratch) },
            0x04 => .{ .nodes = try decodeNodes(data, scratch) },
            0x05 => .{ .talk_request = try decodeTalkRequest(data) },
            0x06 => .{ .talk_response = try decodeTalkResponse(data) },
            else => error.UnsupportedMessage,
        };
    }

    pub fn requestId(self: *const Message) RequestId {
        return switch (self.*) {
            inline else => |value| value.request_id,
        };
    }

    fn code(self: *const Message) u8 {
        return switch (self.*) {
            .ping => 0x01,
            .pong => 0x02,
            .find_node => 0x03,
            .nodes => 0x04,
            .talk_request => 0x05,
            .talk_response => 0x06,
        };
    }
};

fn encodePayload(message: *const Message, writer: *rlp.Writer) Error!void {
    const message_mark = try writer.beginList();
    switch (message.*) {
        .ping => |*ping| try encodePing(writer, ping),
        .pong => |*pong| try encodePong(writer, pong),
        .find_node => |*find_node| try encodeFindNode(writer, find_node),
        .nodes => |*nodes| try encodeNodes(writer, nodes),
        .talk_request => |*talk_request| try encodeTalkRequest(writer, talk_request),
        .talk_response => |*talk_response| try encodeTalkResponse(writer, talk_response),
    }
    writer.finishList(message_mark);
}

fn encodePing(writer: *rlp.Writer, ping: *const Ping) Error!void {
    try writer.writeBytes(ping.request_id.slice());
    try writer.writeUint(ping.enr_sequence);
}

fn encodePong(writer: *rlp.Writer, pong: *const Pong) Error!void {
    try writer.writeBytes(pong.request_id.slice());
    try writer.writeUint(pong.enr_sequence);
    switch (pong.recipient_ip) {
        .ip4 => |*octets| try writer.writeBytes(octets),
        .ip6 => |*octets| try writer.writeBytes(octets),
    }
    try writer.writeUint(pong.recipient_port);
}

fn encodeFindNode(writer: *rlp.Writer, find_node: *const FindNode) Error!void {
    if (find_node.distances.len > types.distance_count) return error.InvalidMessage;
    try writer.writeBytes(find_node.request_id.slice());
    const distances_mark = try writer.beginList();
    for (find_node.distances) |distance| {
        if (distance > types.distance_max) return error.InvalidMessage;
        try writer.writeUint(distance);
    }
    writer.finishList(distances_mark);
}

fn encodeNodes(writer: *rlp.Writer, nodes: *const Nodes) Error!void {
    if (nodes.enrs.len > types.findnode_result_max) return error.InvalidMessage;
    try writer.writeBytes(nodes.request_id.slice());
    try writer.writeUint(nodes.total);
    const enrs_mark = try writer.beginList();
    for (nodes.enrs) |enr| try writer.writeRawItem(enr);
    writer.finishList(enrs_mark);
}

fn encodeTalkRequest(writer: *rlp.Writer, talk_request: *const TalkRequest) Error!void {
    try writer.writeBytes(talk_request.request_id.slice());
    try writer.writeBytes(talk_request.protocol);
    try writer.writeBytes(talk_request.request);
}

fn encodeTalkResponse(writer: *rlp.Writer, talk_response: *const TalkResponse) Error!void {
    try writer.writeBytes(talk_response.request_id.slice());
    try writer.writeBytes(talk_response.response);
}

fn decodePing(data: []const u8) Error!Ping {
    var list = try readMessageList(data);
    const request_id = try readRequestId(&list);
    const enr_sequence = try readUint(&list);
    try expectEnd(&list);
    return .{ .request_id = request_id, .enr_sequence = enr_sequence };
}

fn decodePong(data: []const u8) Error!Pong {
    var list = try readMessageList(data);
    const request_id = try readRequestId(&list);
    const enr_sequence = try readUint(&list);
    const ip_bytes = try readBytes(&list);
    const port = try readUint(&list);
    if (port > std.math.maxInt(u16)) return error.InvalidMessage;
    try expectEnd(&list);
    return .{
        .request_id = request_id,
        .enr_sequence = enr_sequence,
        .recipient_ip = switch (ip_bytes.len) {
            4 => .{ .ip4 = ip_bytes[0..4].* },
            16 => .{ .ip6 = ip_bytes[0..16].* },
            else => return error.InvalidMessage,
        },
        .recipient_port = @intCast(port),
    };
}

fn decodeFindNode(data: []const u8, scratch: *DecodeScratch) Error!FindNode {
    var list = try readMessageList(data);
    const request_id = try readRequestId(&list);
    var distances = try readList(&list);
    var seen = std.StaticBitSet(types.distance_count).empty;
    var distances_count: usize = 0;
    while (!distances.atEnd()) {
        const distance = try readUint(&distances);
        if (distance > types.distance_max) return error.InvalidMessage;
        const index: usize = @intCast(distance);
        if (seen.isSet(index)) continue;
        seen.set(index);
        scratch.distances[distances_count] = @intCast(distance);
        distances_count += 1;
    }
    try expectEnd(&list);

    return .{ .request_id = request_id, .distances = scratch.distances[0..distances_count] };
}

fn decodeNodes(data: []const u8, scratch: *DecodeScratch) Error!Nodes {
    var list = try readMessageList(data);
    const request_id = try readRequestId(&list);
    const total = try readUint(&list);
    var enrs = try readList(&list);
    var enrs_count: usize = 0;
    while (!enrs.atEnd()) {
        if (enrs_count == types.findnode_result_max) return error.InvalidMessage;
        scratch.enrs[enrs_count] = enrs.readRawItem() catch return error.InvalidEncoding;
        enrs_count += 1;
    }
    try expectEnd(&list);

    return .{ .request_id = request_id, .total = total, .enrs = scratch.enrs[0..enrs_count] };
}

fn decodeTalkRequest(data: []const u8) Error!TalkRequest {
    var list = try readMessageList(data);
    const result = TalkRequest{
        .request_id = try readRequestId(&list),
        .protocol = try readBytes(&list),
        .request = try readBytes(&list),
    };
    try expectEnd(&list);
    return result;
}

fn decodeTalkResponse(data: []const u8) Error!TalkResponse {
    var list = try readMessageList(data);
    const result = TalkResponse{
        .request_id = try readRequestId(&list),
        .response = try readBytes(&list),
    };
    try expectEnd(&list);
    return result;
}

fn readMessageList(data: []const u8) Error!rlp.Reader {
    if (data.len < 2) return error.InvalidMessage;
    var outer = rlp.Reader.init(data[1..]);
    const list = outer.readList() catch return error.InvalidEncoding;
    if (!outer.atEnd()) return error.InvalidEncoding;
    return list;
}

fn readRequestId(reader: *rlp.Reader) Error!RequestId {
    return RequestId.init(try readBytes(reader));
}

fn readBytes(reader: *rlp.Reader) Error![]const u8 {
    return reader.readBytes() catch return error.InvalidEncoding;
}

fn readList(reader: *rlp.Reader) Error!rlp.Reader {
    return reader.readList() catch return error.InvalidEncoding;
}

fn readUint(reader: *rlp.Reader) Error!u64 {
    return reader.readUint() catch return error.InvalidEncoding;
}

fn expectEnd(reader: *const rlp.Reader) Error!void {
    if (!reader.atEnd()) return error.InvalidEncoding;
}

comptime {
    std.debug.assert(@sizeOf(RequestId) <= 16);
    std.debug.assert(@sizeOf(Message) <= 64);
    std.debug.assert(@sizeOf(DecodeScratch) <= 3 * 1_024);
}

test {
    _ = @import("message_test.zig");
}
