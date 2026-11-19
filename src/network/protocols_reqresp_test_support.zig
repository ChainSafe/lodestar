const std = @import("std");
const reqresp = @import("reqresp/ReqResp.zig");
const protocol = @import("reqresp/protocol.zig");
const Engine = @import("quic/Engine.zig");
const multistream = @import("wire/multistream.zig");
const Event = reqresp.Event;
const ForkEntry = @import("types.zig").ForkEntry;
const protocols_test_support = @import("protocols_test_support.zig");
const protocols = @import("protocols.zig");
const requests = @import("reqresp/test_pair.zig");

pub const Overrides = requests.Overrides;
pub const statusBytes = requests.statusBytes;

pub const Pair = struct {
    shared: protocols_test_support.ProtocolsPair = .{},
    forks: [2]ForkEntry = .{
        .{ .digest = requests.deneb_digest, .fork = .deneb },
        .{ .digest = requests.fulu_digest, .fork = .fulu },
    },
    client_events: [32]Event = undefined,
    client_count: usize = 0,
    server_events: [32]Event = undefined,
    server_count: usize = 0,
    server_event_capacity: usize = 16,

    pub fn init(self: *Pair, client: Overrides, server: Overrides) !void {
        try self.shared.init(try protocolsOptions(client, &self.forks), try protocolsOptions(server, &self.forks));
    }

    fn protocolsOptions(overrides: Overrides, forks: []const ForkEntry) !protocols.Protocols.Options {
        return .{ .reqresp = try requests.Pair.options(overrides, forks), .control_reqresp = try requests.Pair.controlOptions(overrides, forks), .router = .{ .negotiations_max = 16 }, .gossipsub = .{ .random_seed = 1, .connected_capacity = 4, .retained_capacity = 9, .retained_outbound_reserve = 1, .seen_capacity = 128, .mcache_capacity = 16, .validation_capacity = 8 } };
    }

    pub fn deinit(self: *Pair) void {
        self.shared.deinit();
    }

    pub fn pumpOnce(self: *Pair) !void {
        const counts = try self.shared.step(.{ .application = self.client_events[0..16], .control = self.client_events[16..] }, .{ .application = self.server_events[0..self.server_event_capacity], .control = self.server_events[16..][0..self.server_event_capacity] });
        std.mem.copyForwards(Event, self.server_events[counts.server.application..], self.server_events[16..][0..counts.server.control]);
        self.server_count = counts.server.application + counts.server.control;
        std.mem.copyForwards(Event, self.client_events[counts.client.application..], self.client_events[16..][0..counts.client.control]);
        self.client_count = counts.client.application + counts.client.control;
    }

    pub fn openRaw(self: *Pair, which: protocol.Protocol) !Engine.StreamHandle {
        return self.openRawOn(self.shared.handles.client, which);
    }

    pub fn openRawOn(self: *Pair, conn: Engine.Handle, which: protocol.Protocol) !Engine.StreamHandle {
        const stream = try self.shared.pair.client.openStream(conn);
        var dialer = try multistream.Dialer.init(which.id());
        var bytes: [2 * multistream.message_length_max]u8 = undefined;
        const proposal = try dialer.initialWrite(&bytes);
        try std.testing.expectEqual(proposal.len, try self.shared.pair.client.write(stream, proposal, false));
        return stream;
    }

    pub fn awaitRawSelection(self: *Pair, stream: Engine.StreamHandle, which: protocol.Protocol) !void {
        var dialer = try multistream.Dialer.init(which.id());
        var bytes: [2 * multistream.message_length_max]u8 = undefined;
        var buffered: usize = 0;
        for (0..20) |_| {
            try self.pumpOnce();
            const read = try self.shared.pair.client.read(stream, bytes[buffered..]);
            buffered += read.len;
            const outcome = try dialer.feed(bytes[0..buffered]);
            std.mem.copyForwards(u8, &bytes, bytes[outcome.consumed..buffered]);
            buffered -= outcome.consumed;
            if (outcome.status == .accepted) {
                try std.testing.expectEqual(@as(usize, 0), buffered);
                return;
            }
            try std.testing.expectEqual(.pending, outcome.status);
        }
        return error.TestUnexpectedResult;
    }

    pub fn clientEvents(self: *const Pair) []const Event {
        return self.client_events[0..self.client_count];
    }

    pub fn serverEvents(self: *const Pair) []const Event {
        return self.server_events[0..self.server_count];
    }
};
