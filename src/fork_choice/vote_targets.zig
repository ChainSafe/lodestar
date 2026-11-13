//! Interned vote targets. Validators that vote alike share one entry, so a vote is a
//! 4-byte id, an epoch adds only a few hundred entries, and `prune` renumbers the
//! entries instead of every validator's vote.

const std = @import("std");
const Allocator = std.mem.Allocator;
const store_mod = @import("store.zig");
const LatestMessage = store_mod.LatestMessage;
const BlockIndex = store_mod.BlockIndex;
const NO_BLOCK = store_mod.NO_BLOCK;

pub const TargetId = u32;
/// Id 0 means "no vote"; its entry is `LatestMessage.none`.
pub const NO_TARGET: TargetId = 0;
pub const NO_NODE: u32 = std.math.maxInt(u32);
/// Below this size the table never compacts early.
pub const MIN_COMPACT_AT: usize = 4096;

pub const VoteTargets = struct {
    messages: std.ArrayList(LatestMessage) = .empty,
    /// Per entry: the node the vote counts on (spec `get_supported_node`), `NO_NODE`
    /// once `prune` dropped its block.
    nodes: std.ArrayList(u32) = .empty,
    ids: std.AutoHashMapUnmanaged(LatestMessage, TargetId) = .empty,
    /// Compact once the table reaches this size, which keeps it small even when
    /// finality stalls and `prune` stops running.
    compact_at: usize = MIN_COMPACT_AT,

    pub fn init(allocator: Allocator) !VoteTargets {
        var self: VoteTargets = .{};
        errdefer self.deinit(allocator);
        try self.messages.append(allocator, .none);
        try self.nodes.append(allocator, NO_NODE);
        return self;
    }

    pub fn deinit(self: *VoteTargets, allocator: Allocator) void {
        self.messages.deinit(allocator);
        self.nodes.deinit(allocator);
        self.ids.deinit(allocator);
        self.* = undefined;
    }

    pub fn len(self: *const VoteTargets) usize {
        return self.messages.items.len;
    }

    pub fn needsCompaction(self: *const VoteTargets) bool {
        return self.messages.items.len >= self.compact_at;
    }

    /// `node` is where `message` counts; only used when the entry is new.
    pub fn getOrInsert(self: *VoteTargets, allocator: Allocator, message: LatestMessage, node: u32) !TargetId {
        if (self.ids.get(message)) |id| return id;
        try self.messages.ensureUnusedCapacity(allocator, 1);
        try self.nodes.ensureUnusedCapacity(allocator, 1);
        const id: TargetId = @intCast(self.messages.items.len);
        try self.ids.putNoClobber(allocator, message, id);
        self.messages.appendAssumeCapacity(message);
        self.nodes.appendAssumeCapacity(node);
        return id;
    }

    /// `prune` moved block `b` to `remap[b]`, `NO_BLOCK` when dropped. An entry on a
    /// dropped block keeps its slot, so the replacement rule still sees it, and stops
    /// counting.
    pub fn remap(self: *VoteTargets, block_remap: []const BlockIndex) void {
        self.ids.clearRetainingCapacity();
        for (self.messages.items[1..], self.nodes.items[1..], 1..) |*message, *node, id| {
            if (message.block != NO_BLOCK) {
                const target = block_remap[message.block];
                message.block = target;
                node.* = if (target == NO_BLOCK) NO_NODE else target * 3 + node.* % 3;
            }
            // Entries that now share a key keep their ids; new votes reuse the first.
            const entry = self.ids.getOrPutAssumeCapacity(message.*);
            if (!entry.found_existing) entry.value_ptr.* = @intCast(id);
        }
    }

    /// Drops entries no id in `id_lists` refers to and renumbers the rest. Allocates
    /// before changing anything, so a failure leaves the table and ids as they were.
    pub fn compact(self: *VoteTargets, allocator: Allocator, id_lists: []const []TargetId) !void {
        const old_len = self.messages.items.len;
        const id_remap = try allocator.alloc(TargetId, old_len);
        defer allocator.free(id_remap);
        // Marks every referenced id, then numbers the marked entries in table order; both
        // per-vote passes are branch-free.
        @memset(id_remap, 0);
        for (id_lists) |ids| {
            for (ids) |id| id_remap[id] = 1;
        }
        id_remap[NO_TARGET] = NO_TARGET;
        var kept: TargetId = 1;
        for (id_remap[1..]) |*new_id| {
            if (new_id.* == 0) continue;
            new_id.* = kept;
            kept += 1;
        }
        var messages = try std.ArrayList(LatestMessage).initCapacity(allocator, kept);
        errdefer messages.deinit(allocator);
        var nodes = try std.ArrayList(u32).initCapacity(allocator, kept);
        errdefer nodes.deinit(allocator);
        var map: std.AutoHashMapUnmanaged(LatestMessage, TargetId) = .empty;
        errdefer map.deinit(allocator);
        try map.ensureTotalCapacity(allocator, kept);

        messages.items.len = kept;
        nodes.items.len = kept;
        messages.items[0] = .none;
        nodes.items[0] = NO_NODE;
        for (id_remap, 0..) |new_id, old_id| {
            if (new_id == NO_TARGET) continue;
            messages.items[new_id] = self.messages.items[old_id];
            nodes.items[new_id] = self.nodes.items[old_id];
        }
        for (messages.items[1..], 1..) |message, id| {
            const entry = map.getOrPutAssumeCapacity(message);
            if (!entry.found_existing) entry.value_ptr.* = @intCast(id);
        }
        for (id_lists) |ids| {
            for (ids) |*id| id.* = id_remap[id.*];
        }
        self.messages.deinit(allocator);
        self.nodes.deinit(allocator);
        self.ids.deinit(allocator);
        self.messages = messages;
        self.nodes = nodes;
        self.ids = map;
        self.compact_at = @max(2 * @as(usize, kept), MIN_COMPACT_AT);
    }
};
