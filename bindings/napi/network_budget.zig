const std = @import("std");

pub const Owner = enum { incoming, outgoing, publication, urgent_publication };
const count = @typeInfo(Owner).@"enum".fields.len;
pub const Diagnostics = struct {
    limitBytes: usize = 0,
    usedBytes: usize = 0,
    incomingMinimumBytes: usize = 0,
    outgoingMinimumBytes: usize = 0,
    publicationMinimumBytes: usize = 0,
};

pub const Budget = struct {
    release_revision: u64 = 0,
    limit: usize = 0,
    used: usize = 0,
    minimum: [count]usize = @splat(0),
    owned: [count]usize = @splat(0),
    /// The owner is waiting for a release to retry a reservation.
    waiting: bool = false,
    /// A release happened while the owner waited; the runtime wakes the owner.
    released: bool = false,

    pub fn snapshot(self: *const Budget) Diagnostics {
        return .{
            .limitBytes = self.limit,
            .usedBytes = self.used,
            .incomingMinimumBytes = self.minimum[@intFromEnum(Owner.incoming)],
            .outgoingMinimumBytes = self.minimum[@intFromEnum(Owner.outgoing)],
            .publicationMinimumBytes = self.minimum[@intFromEnum(Owner.urgent_publication)],
        };
    }

    pub fn protect(self: *Budget, incoming: usize, outgoing: usize, publication: usize) !void {
        std.debug.assert(self.used == 0);
        const total = try std.math.add(usize, incoming, try std.math.add(usize, outgoing, publication));
        if (total > self.limit) return error.NetworkBridgeBudgetExceeded;
        self.minimum = .{ incoming, outgoing, 0, publication };
    }

    pub fn reserve(self: *Budget, owner: Owner, amount: usize) !void {
        std.debug.assert(self.used <= self.limit);
        var protected: usize = 0;
        for (self.minimum, self.owned, 0..) |minimum, owned, i| {
            if (i != @intFromEnum(owner)) protected += minimum -| owned;
        }
        if (amount > self.limit - self.used -| protected) return error.NetworkBridgeFull;
        self.used += amount;
        self.owned[@intFromEnum(owner)] += amount;
    }

    pub fn release(self: *Budget, owner: Owner, amount: usize) void {
        std.debug.assert(amount <= self.used and amount <= self.owned[@intFromEnum(owner)]);
        self.used -= amount;
        self.owned[@intFromEnum(owner)] -= amount;
        if (amount > 0) self.release_revision += 1;
        if (self.waiting and amount > 0) {
            self.waiting = false;
            self.released = true;
        }
    }
};

test {
    _ = @import("network_budget_test.zig");
}
