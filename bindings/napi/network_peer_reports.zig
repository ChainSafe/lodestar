const std = @import("std");
const n = @import("network");
const t = n.peers.types;
const capacity = 512;
/// Saturates each queued identity, origin, reason and action at the peer score floor.
pub const report_max = 100;
const Row = struct {
    occupied: bool = false,
    report: t.PeerReport = undefined,
    counts: [4]u8 = @splat(0),
};
pub const Report = t.PeerReport;

pub const Table = struct {
    rows: [capacity]Row = @splat(.{}),
    pending: u32 = 0,
    ignored: u64 = 0,
    dropped: u64 = 0,
    cursor: u16 = 0,

    /// Reports from different connections, endpoints or causes must not merge.
    pub fn addCount(self: *Table, report: *const Report, count: u8) void {
        var vacant: ?usize = null;
        const row_index = found: {
            for (&self.rows, 0..) |*row, i| {
                if (!row.occupied) {
                    if (vacant == null) vacant = i;
                    continue;
                }
                if (row.report.identity.eql(&report.identity) and
                    std.meta.eql(row.report.origin, report.origin) and row.report.reason == report.reason)
                    break :found i;
            }
            const i = vacant orelse {
                self.ignored +|= 1;
                self.dropped +|= 1;
                return;
            };
            self.rows[i] = .{ .occupied = true, .report = report.* };
            break :found i;
        };
        const counted = &self.rows[row_index].counts[@intFromEnum(report.action)];
        // A hundred of the smallest penalty already reaches the score floor.
        const added = @min(count, report_max - counted.*);
        counted.* += added;
        self.pending += added;
    }

    pub fn next(self: *Table) ?Report {
        if (self.pending == 0) return null;
        for (0..capacity) |_| {
            const row_index = self.cursor;
            self.cursor = (self.cursor + 1) % capacity;
            const row = &self.rows[row_index];
            if (!row.occupied) continue;
            for (&row.counts, 0..) |*count, action| {
                if (count.* == 0) continue;
                count.* -= 1;
                self.pending -= 1;
                var report = row.report;
                report.action = @enumFromInt(action);
                if (std.mem.allEqual(u8, &row.counts, 0)) {
                    row.* = .{};
                }
                return report;
            }
            unreachable;
        }
        unreachable;
    }
};

test {
    _ = @import("network_peer_reports_test.zig");
}
