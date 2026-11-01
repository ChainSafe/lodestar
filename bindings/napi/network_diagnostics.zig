const std = @import("std");
const n = @import("network");

/// One executing diagnostic command owns this buffer through JavaScript result construction.
pub const Buffer = struct {
    backing: std.mem.Allocator,
    gossip: n.gossipsub.diagnostics.Page,
    scores: []n.NetworkCore.PeerScore,
    count: usize = 0,
    observed: n.Now = undefined,

    pub fn create(backing: std.mem.Allocator, capacity: usize, topics: usize) !*Buffer {
        const self = try backing.create(Buffer);
        errdefer backing.destroy(self);
        const scores = try backing.alloc(n.NetworkCore.PeerScore, capacity);
        errdefer backing.free(scores);
        self.* = .{ .backing = backing, .scores = scores, .gossip = try n.gossipsub.diagnostics.Page.init(backing, topics) };
        return self;
    }
    pub fn destroy(self: *Buffer) void {
        self.gossip.deinit(self.backing);
        self.backing.free(self.scores);
        self.backing.destroy(self);
    }
    pub fn bytes(capacity: usize, topics: usize) usize {
        return @sizeOf(Buffer) + capacity * @sizeOf(n.NetworkCore.PeerScore) + n.gossipsub.diagnostics.Page.backingBytes(topics);
    }
    pub fn captureScores(self: *Buffer, core: *const n.NetworkCore, now: n.Now) !void {
        self.count = try core.peerScores(now, self.scores);
        self.observed = now;
    }
};

test {
    _ = @import("network_diagnostics_test.zig");
}
