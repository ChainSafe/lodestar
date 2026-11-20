//! Remembered peers: outbound peers that served us, each with the QUIC endpoint we dialed, so a
//! restart can redial them. The caller loads records at startup and checkpoints snapshots.
//! Native decides what qualifies, replays loaded records once as automatic candidates, and
//! forgets a record when health, rejection or identity evidence invalidates it.
//! Records carry wall-clock seconds so they outlive the process.
const std = @import("std");
const t = @import("types.zig");
const Now = @import("../types.zig").Now;

/// Records kept, and the most a seed list or a snapshot holds.
pub const capacity = 256;
/// A record qualified this long ago is dropped.
const expiry_s: u64 = 24 * 60 * 60;
/// A dialed connection qualifies once it has served this long since its admission.
pub const qualify_ms: u64 = 5 * 60_000;

pub const Record = struct {
    peer: t.PeerId,
    /// The endpoint our dial reached when the peer last qualified, never an inbound source.
    address: t.Address,
    /// Wall-clock seconds at which the peer last qualified.
    qualified_at_s: u64,
};

/// Where an automatic dial's candidate came from: discovery, or a remembered record.
pub const Origin = enum { fresh, remembered };
pub const Stage = enum { dialed, connected, kept };
/// Outcomes of loading a seed record.
pub const Seed = enum { loaded, expired, duplicate, invalid };
/// Outcomes of replaying a loaded record: queued as a candidate, already connected or a
/// candidate, refused by the identity's rejection memory, held back by the endpoint's failure
/// history or the peer's own dial deadlines, or no candidate room.
pub const Replay = enum { queued, known, rejected, failed, capacity };

pub const Counters = struct {
    seeds: [@typeInfo(Seed).@"enum".fields.len]u64 = @splat(0),
    replays: [@typeInfo(Replay).@"enum".fields.len]u64 = @splat(0),
    /// Automatic dials by origin and stage: started, connected, and kept `qualify_ms` with a
    /// completed Status and Metadata exchange.
    funnel: [@typeInfo(Origin).@"enum".fields.len][@typeInfo(Stage).@"enum".fields.len]u64 = @splat(@splat(0)),
};

const Entry = struct {
    record: Record,
    /// Loaded from a seed and not yet replayed.
    pending: bool,
};

pub const Memory = struct {
    slots: []?Entry,
    count: u16 = 0,
    /// Slots of the loaded records in replay order, which `cursor` walks once.
    order: [capacity]u8 = undefined,
    order_len: u16 = 0,
    cursor: u16 = 0,
    counters: Counters = .{},

    pub fn init(a: std.mem.Allocator) !Memory {
        const slots = try a.alloc(?Entry, capacity);
        @memset(slots, null);
        return .{ .slots = slots };
    }

    pub fn deinit(self: *Memory, a: std.mem.Allocator) void {
        a.free(self.slots);
        self.* = undefined;
    }

    /// Loads seeds once, before any record qualifies. Drops records that expired, name
    /// an unusable endpoint or the local identity, and merges duplicate identities into the newest.
    /// A record dated after now counts from now. Replay visits the rest in a shuffled order that
    /// takes one record per address prefix in turn.
    pub fn load(self: *Memory, seeds: []const Record, local: *const t.PeerId, now_s: u64, random: std.Random) void {
        std.debug.assert(self.count == 0 and self.order_len == 0 and seeds.len <= capacity);
        for (seeds) |*seed| {
            if (!seed.address.isUsable() or seed.peer.eql(local)) {
                self.counters.seeds[@intFromEnum(Seed.invalid)] +|= 1;
                continue;
            }
            const qualified_at_s = @min(seed.qualified_at_s, now_s);
            if (expired(qualified_at_s, now_s)) {
                self.counters.seeds[@intFromEnum(Seed.expired)] +|= 1;
                continue;
            }
            if (self.find(&seed.peer)) |index| {
                self.counters.seeds[@intFromEnum(Seed.duplicate)] +|= 1;
                const kept = &self.slots[index].?.record;
                if (qualified_at_s > kept.qualified_at_s) kept.* = .{ .peer = seed.peer, .address = seed.address, .qualified_at_s = qualified_at_s };
                continue;
            }
            self.slots[self.count] = .{ .record = .{ .peer = seed.peer, .address = seed.address, .qualified_at_s = qualified_at_s }, .pending = true };
            self.count += 1;
        }
        self.counters.seeds[@intFromEnum(Seed.loaded)] +|= self.count;
        self.orderReplay(random);
    }

    /// Shuffles the loaded slots, then orders them by how many earlier shuffled records share
    /// their address prefix, so consecutive replays spread across prefixes.
    fn orderReplay(self: *Memory, random: std.Random) void {
        const loaded = self.count;
        var shuffled: [capacity]u8 = undefined;
        for (shuffled[0..loaded], 0..) |*slot, index| slot.* = @intCast(index);
        random.shuffle(u8, shuffled[0..loaded]);
        var keys: [capacity]u32 = undefined;
        for (shuffled[0..loaded], 0..) |slot, position| {
            const own = prefix(self.slots[slot].?.record.address);
            var rank: u32 = 0;
            for (shuffled[0..position]) |earlier| rank += @intFromBool(prefix(self.slots[earlier].?.record.address) == own);
            keys[position] = rank * capacity + @as(u32, @intCast(position));
        }
        std.sort.pdq(u32, keys[0..loaded], {}, std.sort.asc(u32));
        for (keys[0..loaded], self.order[0..loaded]) |key, *slot| slot.* = shuffled[key % capacity];
        self.order_len = loaded;
        self.cursor = 0;
    }

    /// Refreshes the peer's record, or adds one, after it served us through the endpoint we
    /// dialed. A full memory drops the record that qualified longest ago.
    pub fn qualify(self: *Memory, peer: *const t.PeerId, address: t.Address, now_s: u64) void {
        std.debug.assert(address.isUsable());
        if (self.find(peer)) |index| {
            const record = &self.slots[index].?.record;
            record.address = address;
            record.qualified_at_s = @max(record.qualified_at_s, now_s);
            return;
        }
        const index = self.free() orelse self.evict();
        self.slots[index] = .{ .record = .{ .peer = peer.*, .address = address, .qualified_at_s = now_s }, .pending = false };
        self.count += 1;
    }

    /// Forgets the peer's record.
    pub fn forget(self: *Memory, peer: *const t.PeerId) void {
        self.remove(self.find(peer) orelse return);
    }

    /// Forgets the peer's record when it names `address`, where another identity answered.
    pub fn forgetEndpoint(self: *Memory, peer: *const t.PeerId, address: t.Address) void {
        const index = self.find(peer) orelse return;
        if (self.slots[index].?.record.address.eql(address)) self.remove(index);
    }

    /// The next loaded record to replay, each at most once, dropping records that expired
    /// meanwhile; null once replay visited every one.
    pub fn nextReplay(self: *Memory, now_s: u64) ?Record {
        while (self.cursor < self.order_len) {
            const index = self.order[self.cursor];
            self.cursor += 1;
            const entry = if (self.slots[index]) |*value| value else continue;
            if (!entry.pending) continue;
            entry.pending = false;
            if (expired(entry.record.qualified_at_s, now_s)) {
                self.remove(index);
                continue;
            }
            return entry.record;
        }
        return null;
    }

    pub fn note(self: *Memory, origin: Origin, stage: Stage) void {
        self.counters.funnel[@intFromEnum(origin)][@intFromEnum(stage)] +|= 1;
    }

    /// Copies every unexpired record into `out`, dropping expired ones.
    pub fn snapshot(self: *Memory, now_s: u64, out: []Record) usize {
        std.debug.assert(out.len >= capacity);
        var copied: usize = 0;
        for (self.slots, 0..) |slot, index| {
            const entry = slot orelse continue;
            if (expired(entry.record.qualified_at_s, now_s)) {
                self.remove(index);
                continue;
            }
            out[copied] = entry.record;
            copied += 1;
        }
        std.debug.assert(copied == self.count);
        return copied;
    }

    fn find(self: *const Memory, peer: *const t.PeerId) ?usize {
        for (self.slots, 0..) |*slot, index| if (slot.*) |*entry| {
            if (entry.record.peer.eql(peer)) return index;
        };
        return null;
    }

    fn free(self: *const Memory) ?usize {
        if (self.count == capacity) return null;
        for (self.slots, 0..) |slot, index| if (slot == null) return index;
        unreachable;
    }

    /// Drops the record that qualified longest ago and returns its slot.
    fn evict(self: *Memory) usize {
        std.debug.assert(self.count == capacity);
        var oldest: usize = 0;
        for (self.slots, 0..) |slot, index| {
            if (slot.?.record.qualified_at_s < self.slots[oldest].?.record.qualified_at_s) oldest = index;
        }
        self.remove(oldest);
        return oldest;
    }

    fn remove(self: *Memory, index: usize) void {
        std.debug.assert(self.slots[index] != null);
        self.slots[index] = null;
        self.count -= 1;
    }
};

fn expired(qualified_at_s: u64, now_s: u64) bool {
    return now_s -| qualified_at_s >= expiry_s;
}

/// Wall-clock seconds, clamped at the epoch.
pub fn seconds(now: Now) u64 {
    return @intCast(@max(0, now.unixSeconds()));
}

/// The IPv4 /16 or IPv6 /32 an address belongs to, which replay spreads its order across.
fn prefix(address: t.Address) u64 {
    return switch (address) {
        .ip4 => |value| @as(u64, 4) << 32 | std.mem.readInt(u16, value.octets[0..2], .big),
        .ip6 => |value| @as(u64, 6) << 32 | std.mem.readInt(u32, value.octets[0..4], .big),
    };
}

comptime {
    std.debug.assert(capacity <= std.math.maxInt(u8) + 1);
}

test {
    _ = @import("remembered_test.zig");
}
