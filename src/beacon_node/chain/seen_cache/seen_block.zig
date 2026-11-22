const std = @import("std");
const Allocator = std.mem.Allocator;
const Root = @import("consensus_types").primitive.Root.Type;

/// Owned SignedBeaconBlock bytes keyed by the unsigned beacon block's root.
/// All access, including use of borrowed bytes, must be serialized against mutation
/// and destruction. Membership does not establish block validity or data availability.
pub const SeenBlock = struct {
    const Self = @This();

    pub const Opts = struct {
        max_blocks: usize = 256,
        /// Retained block bytes only; map storage is bounded separately by max_blocks.
        max_bytes: usize = 64 * 1024 * 1024,
        /// Local storage policy, not an SSZ or consensus validity limit.
        max_block_bytes: usize = 10 * 1024 * 1024,
    };

    allocator: Allocator,
    opts: Opts,
    blocks: std.array_hash_map.Auto(Root, []const u8),
    total_bytes: usize = 0,

    pub fn init(allocator: Allocator, opts: Opts) !Self {
        if (opts.max_blocks == 0 or opts.max_bytes == 0 or opts.max_block_bytes == 0 or
            opts.max_block_bytes > opts.max_bytes)
        {
            return error.InvalidOptions;
        }

        var blocks: std.array_hash_map.Auto(Root, []const u8) = .empty;
        errdefer blocks.deinit(allocator);
        try blocks.ensureTotalCapacity(allocator, opts.max_blocks);

        return .{ .allocator = allocator, .opts = opts, .blocks = blocks };
    }

    pub fn deinit(self: *Self) void {
        self.clear();
        self.blocks.deinit(self.allocator);
    }

    /// Copies complete fork-specific SSZ SignedBeaconBlock bytes. The trusted caller
    /// supplies the matching message root and full (not blinded) block; no decoding,
    /// root, signature, or consensus validation occurs here.
    /// Returns false for a duplicate before inspecting bytes or allocating. The first
    /// signature/bytes and FIFO position remain resident, even if the new bytes differ.
    /// Errors preserve all entries, their borrows, and caller ownership. Successful
    /// insertion evicts oldest insertions until both limits fit, invalidating their borrows.
    pub fn add(self: *Self, root: Root, bytes: []const u8) !bool {
        if (self.has(root)) return false;
        if (bytes.len == 0) return error.EmptyBlock;
        if (bytes.len > self.opts.max_block_bytes) return error.BlockTooLarge;

        // Allocate before eviction, including when bytes alias a resident block.
        // Map capacity was reserved in init, so nothing below this copy can fail.
        const owned = try self.allocator.dupe(u8, bytes);
        while (self.size() >= self.opts.max_blocks or self.total_bytes > self.opts.max_bytes - owned.len) {
            const oldest = self.blocks.values()[0];
            self.blocks.orderedRemoveAt(0);
            self.total_bytes -= oldest.len;
            self.allocator.free(oldest);
        }

        self.blocks.putAssumeCapacityNoClobber(root, owned);
        self.total_bytes += owned.len;
        return true;
    }

    /// Returns a read-only borrow or null on miss, without refreshing FIFO order.
    /// Do not free it. Removal/eviction of this root, clear, or deinit invalidates it;
    /// a caller spanning those mutations or a wait must first copy or decode it into
    /// independently owned storage. Other entries' mutations do not move these bytes.
    pub fn get(self: *const Self, root: Root) ?[]const u8 {
        return self.blocks.get(root);
    }

    pub fn has(self: *const Self, root: Root) bool {
        return self.blocks.contains(root);
    }

    pub fn remove(self: *Self, root: Root) bool {
        const removed = self.blocks.fetchOrderedRemove(root) orelse return false;
        self.total_bytes -= removed.value.len;
        self.allocator.free(removed.value);
        return true;
    }

    /// Releases all block bytes, retaining the bounded map allocation for reuse.
    pub fn clear(self: *Self) void {
        for (self.blocks.values()) |bytes| self.allocator.free(bytes);
        self.blocks.clearRetainingCapacity();
        self.total_bytes = 0;
    }

    pub fn size(self: *const Self) usize {
        return self.blocks.count();
    }

    pub fn byteSize(self: *const Self) usize {
        return self.total_bytes;
    }
};

test {
    _ = @import("seen_block_test.zig");
}
