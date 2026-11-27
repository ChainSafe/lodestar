const std = @import("std");
const PeerId = @import("types.zig").PeerId;

pub const empty = std.math.maxInt(u16);

pub fn capacity(rows: usize) usize {
    return std.math.ceilPowerOfTwo(usize, @max(2, rows * 2)) catch unreachable;
}

/// Borrows row identities. Remove membership before overwriting an identity.
pub const Index = struct {
    slots: []u16,
    seed: u64,

    fn position(self: *const Index, identity: *const PeerId) usize {
        return @as(usize, @truncate(std.hash.Wyhash.hash(self.seed, &identity.bytes))) & (self.slots.len - 1);
    }

    pub fn find(self: *const Index, rows: anytype, identity: *const PeerId) ?u16 {
        var pos = self.position(identity);
        for (0..self.slots.len) |_| {
            const index = self.slots[pos];
            if (index == empty) return null;
            if (rows[index].identity.eql(identity)) return index;
            pos = (pos + 1) & (self.slots.len - 1);
        }
        unreachable;
    }

    pub fn insert(self: *const Index, rows: anytype, index: u16) void {
        std.debug.assert(index < rows.len and rows.len * 2 <= self.slots.len);
        std.debug.assert(self.find(rows, &rows[index].identity) == null);
        var pos = self.position(&rows[index].identity);
        for (0..self.slots.len) |_| {
            if (self.slots[pos] == empty) {
                self.slots[pos] = index;
                return;
            }
            pos = (pos + 1) & (self.slots.len - 1);
        }
        unreachable;
    }

    pub fn remove(self: *const Index, rows: anytype, identity: *const PeerId) void {
        const mask = self.slots.len - 1;
        var pos = self.position(identity);
        for (0..self.slots.len) |_| {
            const index = self.slots[pos];
            if (index == empty) return;
            if (rows[index].identity.eql(identity)) break;
            pos = (pos + 1) & mask;
        } else unreachable;
        var hole = pos;
        pos = (pos + 1) & mask;
        for (0..self.slots.len) |_| {
            const index = self.slots[pos];
            if (index == empty) {
                self.slots[hole] = empty;
                return;
            }
            const home = self.position(&rows[index].identity);
            if ((pos -% home) & mask >= (pos -% hole) & mask) {
                self.slots[hole] = index;
                hole = pos;
            }
            pos = (pos + 1) & mask;
        }
        unreachable;
    }
};

test {
    _ = @import("identity_index_test.zig");
}
