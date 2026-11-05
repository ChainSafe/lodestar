const std = @import("std");
const constants = @import("constants.zig");
const Sessions = @import("sessions.zig").Sessions;
const PeerBook = @import("peer_book.zig").PeerBook;

pub const Score = struct { generation: u64 = 0, value: f64 = 0 };
pub const Scores = [constants.peers_cap]Score;

pub const Cycle = struct {
    scores: Scores = @splat(.{}),
    order: []u16,
    cursor: usize = 0,
    phase: union(enum) { idle, active: usize } = .idle,
    epoch: u64 = 0,
    opportunistic: bool = false,

    pub fn takeSnapshot(self: *Cycle, sessions: *const Sessions, peers: *PeerBook, now: u64) void {
        for (sessions.rows, 0..) |*peer, i| {
            self.scores[i] = if (peer.active) .{ .generation = peer.generation, .value = peers.score(peer.logical, now) } else .{};
        }
    }

    pub fn begin(self: *Cycle, sessions: *const Sessions, peers: *PeerBook, now: u64, opportunistic: bool, random: std.Random) void {
        std.debug.assert(self.phase == .idle and self.epoch < std.math.maxInt(u64));
        std.debug.assert(self.order.len == peers.scores.topic_params.len);
        self.epoch += 1;
        self.takeSnapshot(sessions, peers, now);
        // Shuffle the whole traversal so topics that have advertisements for a given peer get
        // equal priority for its bounded budget, regardless of inactive or empty topics between them.
        for (self.order, 0..) |*topic, index| topic.* = @intCast(index);
        for (0..self.order.len -| 1) |i| {
            const j = i + random.uintLessThanBiased(usize, self.order.len - i);
            std.mem.swap(u16, &self.order[i], &self.order[j]);
        }
        self.cursor = 0;
        self.phase = .{ .active = self.order.len };
        self.opportunistic = opportunistic;
    }

    pub fn isActive(self: *const Cycle) bool {
        return self.phase == .active;
    }

    pub fn complete(self: *Cycle) ?u64 {
        if (self.phase == .idle or self.phase.active != 0) return null;
        self.phase = .idle;
        return self.epoch;
    }

    pub fn next(self: *Cycle) ?u16 {
        if (self.phase == .idle or self.phase.active == 0) return null;
        const index = self.order[self.cursor];
        self.cursor += 1;
        self.phase.active -= 1;
        return index;
    }
};
