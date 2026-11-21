const std = @import("std");
const CallTable = @import("CallTable.zig");
const Engine = @import("Engine.zig");
const PendingResponse = @import("PendingResponse.zig");
const enr = @import("identity/enr.zig");
const message = @import("wire/message.zig");
const constants = @import("wire/constants.zig");
const support = @import("test_support.zig");

const Datagram = struct {
    sender: u1,
    length: u16 = 0,
    bytes: [constants.packet_size_max]u8 = undefined,
};

const Network = struct {
    nodes: [2]Engine,
    records: [2]enr.Record,
    scratch: [2]Engine.Scratch = .{ .{}, .{} },
    handle: CallTable.Handle = undefined,
    completions: u8 = 0,

    fn init(self: *Network) !void {
        self.* = .{ .nodes = undefined, .records = undefined };
        for (0..2) |index| {
            const key = try support.keyPair(@intCast(0x11 + index * 0x11));
            self.records[index] = try enr.Record.create(&key, 1, support.loopback(@intCast(index + 1), @intCast(9_001 + index)));
        }
        try self.nodes[0].init(std.testing.allocator, try support.keyPair(0x11), self.records[0], support.engineConfig());
        errdefer self.nodes[0].deinit(std.testing.allocator);
        try self.nodes[1].init(std.testing.allocator, try support.keyPair(0x22), self.records[1], support.engineConfig());
    }

    fn deinit(self: *Network) void {
        for (&self.nodes) |*node| node.deinit(std.testing.allocator);
    }

    fn start(self: *Network, out: *Datagram) !void {
        const request = message.Message{ .ping = .{
            .request_id = try message.RequestId.init(&.{1}),
            .enr_sequence = 1,
        } };
        const started = try self.nodes[0].startCall(&out.bytes, support.endpoint(&self.records[1]), &self.records[1], &request, 1, &support.sealEntropy(10));
        self.handle = started.handle;
        out.sender = 0;
        out.length = started.packet_length;
    }

    fn deliver(self: *Network, input: *const Datagram, out: *Datagram, now_ms: u64) !bool {
        const recipient: u1 = 1 - input.sender;
        out.sender = recipient;
        const outcome = try self.nodes[recipient].receive(&out.bytes, input.bytes[0..input.length], support.endpoint(&self.records[input.sender]).address, support.receiveArgs(now_ms, @intCast(20 + now_ms % 128)), &self.scratch[recipient]);
        const accepted = switch (outcome) {
            .accepted => |accepted| accepted,
            .rejected => return false,
        };
        out.length = accepted.packet_length;
        switch (accepted.event) {
            .request => |request| {
                var response: PendingResponse = .{};
                try self.nodes[recipient].prepareStandardResponse(&request, &response);
                out.length = (try self.nodes[recipient].encodeNextStandardResponse(&out.bytes, &response, now_ms, &support.sealEntropy(60))).?;
                try std.testing.expect(response.complete());
            },
            .response => |response| {
                try std.testing.expectEqual(self.handle, response.matched.handle);
                try std.testing.expect(response.matched.terminal);
                self.completions += 1;
            },
            .failed => return error.UnexpectedCallFailure,
            .none => {},
        }
        try std.testing.expect(self.completions <= 1);
        return out.length > 0;
    }
};

test "bounded dropped duplicated and delayed packets deliver one terminal outcome" {
    for (0..5) |drop_at| {
        for ([_]bool{ false, true }) |duplicate| {
            var network: Network = undefined;
            try network.init();
            defer network.deinit();
            var current: Datagram = .{ .sender = 0 };
            try network.start(&current);
            var held: ?Datagram = null;
            for (0..4) |stage| {
                if (stage == drop_at) {
                    held = current;
                    break;
                }
                var next: Datagram = .{ .sender = 0 };
                const emitted = try network.deliver(&current, &next, stage + 2);
                if (duplicate) {
                    var ignored: Datagram = .{ .sender = 0 };
                    try std.testing.expect(!try network.deliver(&current, &ignored, stage + 2));
                }
                if (!emitted) break;
                current = next;
            }
            try std.testing.expectEqual(@as(u8, if (drop_at == 4) 1 else 0), network.completions);
            var expired: [4]CallTable.Expired = undefined;
            const terminal = network.nodes[0].expire(200, &expired);
            try std.testing.expectEqual(@as(usize, 1), terminal.calls + network.completions);
            if (terminal.calls == 1) try std.testing.expectEqual(network.handle, expired[0].handle);
            _ = network.nodes[1].expire(200, &expired);
            if (held) |packet| {
                current = packet;
                for (0..4) |stage| {
                    var next: Datagram = .{ .sender = 0 };
                    if (!try network.deliver(&current, &next, stage + 201)) break;
                    current = next;
                }
            }
            try std.testing.expectEqual(@as(usize, 0), network.nodes[0].expire(400, &expired).calls);
            try std.testing.expectEqual(@as(usize, 0), network.nodes[0].calls.count());
            try std.testing.expectEqual(@as(u8, if (drop_at == 4) 1 else 0), network.completions);
        }
    }
}
