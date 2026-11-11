//! Flat, index-addressed copy of the validator fields the epoch transition reads.
//!
//! The cache is derived from the validators tree and should never be written directly.
//! Use `sync` to do that. `sync` diffs the tree it was last synced to against
//! the target tree and patches only the leaves whose node id differs,
//! so the cost is proportional to the number of changed validators.
//!
//! Owner decides the lifetime and must `deinit` it before the pool it
//! serves is torn down, because of the ref it holds.

const std = @import("std");
const Allocator = std.mem.Allocator;
const BoundedArray = @import("bounded_array").BoundedArray;
const types = @import("consensus_types");
const Node = @import("persistent_merkle_tree").Node;
const max_depth = @import("persistent_merkle_tree").max_depth;
const hasCompoundingWithdrawalCredential = @import("../utils/electra.zig").hasCompoundingWithdrawalCredential;

const Validator = types.phase0.Validator;

/// Fields that EpochTransitionCache.init needs to know about one validator.
pub const ValidatorFields = struct {
    activation_eligibility_epoch: u64,
    activation_epoch: u64,
    exit_epoch: u64,
    withdrawable_epoch: u64,
    effective_balance: u64,
    bits: Bits,

    pub const Bits = packed struct(u8) {
        slashed: bool,
        compounding: bool,
        _: u6 = 0,
    };

    pub inline fn fromValidator(v: *const Validator.Type) ValidatorFields {
        return .{
            .activation_eligibility_epoch = v.activation_eligibility_epoch,
            .activation_epoch = v.activation_epoch,
            .exit_epoch = v.exit_epoch,
            .withdrawable_epoch = v.withdrawable_epoch,
            .effective_balance = v.effective_balance,
            .bits = .{
                .slashed = v.slashed,
                .compounding = hasCompoundingWithdrawalCredential(&v.withdrawal_credentials),
            },
        };
    }
};

const Layout = union(enum) {
    bounded: usize,
    progressive,
};

const ValidatorSubtree = struct {
    root: Node.Id,
    depth: usize,
    base: usize,
    end: usize,
};

fn ValidatorSubtrees(comptime Validators: type) type {
    return struct {
        pool: *Node.Pool,
        node: Node.Id,
        len: usize,
        base: usize = 0,
        depth: usize,

        fn init(pool: *Node.Pool, root: Node.Id, len: usize) !@This() {
            return .{
                .pool = pool,
                .node = try root.getLeft(pool),
                .len = len,
                .depth = if (Validators.kind == .list) Validators.chunk_depth else 0,
            };
        }

        fn next(self: *@This()) !?ValidatorSubtree {
            if (self.base >= self.len) return null;
            const capacity = @as(usize, 1) << @intCast(self.depth);
            const subtree: ValidatorSubtree = .{
                .root = if (Validators.kind == .list) self.node else try self.node.getLeft(self.pool),
                .depth = self.depth,
                .base = self.base,
                .end = self.base + @min(capacity, self.len - self.base),
            };
            self.base = subtree.end;
            if (Validators.kind == .progressive_list and self.base < self.len) {
                self.node = try self.node.getRight(self.pool);
                self.depth += 2;
            }
            return subtree;
        }
    };
}

pub const ValidatorFlatCache = struct {
    allocator: Allocator,
    pool: *Node.Pool,
    synced_root: ?Node.Id = null,
    synced_layout: ?Layout = null,
    fields: std.MultiArrayList(ValidatorFields) = .empty,
    /// Leaves rewritten by the last `sync`.
    last_patched: usize = 0,

    pub fn init(allocator: Allocator, pool: *Node.Pool) ValidatorFlatCache {
        return .{ .allocator = allocator, .pool = pool };
    }

    pub fn deinit(self: *ValidatorFlatCache) void {
        self.invalidate();
        self.fields.deinit(self.allocator);
        self.* = undefined;
    }

    pub fn len(self: *const ValidatorFlatCache) usize {
        return self.fields.len;
    }

    pub fn capacityInBytes(self: *const ValidatorFlatCache) usize {
        return @TypeOf(self.fields).capacityInBytes(self.fields.capacity);
    }

    /// Bring the cache in line with the validators list rooted at `root`.
    /// On error the cache is left empty and the next call refills it.
    pub fn sync(self: *ValidatorFlatCache, comptime Validators: type, root: Node.Id, new_len: usize) !void {
        comptime {
            if (Validators.Element != Validator or (Validators.kind != .list and Validators.kind != .progressive_list)) {
                @compileError("validator cache requires a list of packed Validators");
            }
        }
        const layout: Layout = if (Validators.kind == .progressive_list) .progressive else .{ .bounded = Validators.chunk_depth };
        self.last_patched = 0;
        errdefer self.invalidate();
        if (new_len > Validators.limit) return error.LengthOverLimit;
        const same_layout = if (self.synced_layout) |old| std.meta.eql(old, layout) else false;
        if (self.synced_root) |old| {
            if (old == root and self.len() == new_len and same_layout) return;
        }

        const old_len = self.len();
        try self.fields.resize(self.allocator, new_len);
        try self.pool.ref(root);
        errdefer self.pool.unref(root);

        const Subtrees = ValidatorSubtrees(Validators);
        var subtrees = try Subtrees.init(self.pool, root, new_len);
        var old_subtrees: ?Subtrees = if (same_layout and self.synced_root != null)
            try Subtrees.init(self.pool, self.synced_root.?, old_len)
        else
            null;
        while (try subtrees.next()) |subtree| {
            const old_subtree = if (old_subtrees) |*it| try it.next() else null;
            if (old_subtree) |old| {
                try self.diffAndPatch(old.root, subtree.root, subtree.depth, subtree.base, old_len, new_len);
            } else {
                var it = Node.DepthIterator.init(self.pool, subtree.root, @intCast(subtree.depth), 0);
                for (subtree.base..subtree.end) |i| try self.patch(i, try it.next());
            }
        }

        if (self.synced_root) |old| self.pool.unref(old);
        self.synced_root = root;
        self.synced_layout = layout;
    }

    pub fn invalidate(self: *ValidatorFlatCache) void {
        if (self.synced_root) |old| self.pool.unref(old);
        self.synced_root = null;
        self.synced_layout = null;
        self.fields.clearRetainingCapacity();
    }

    /// Compares `new` and `old` validator trees, patching only validators inside changed subtrees.
    ///
    /// This does a depth-first traversal through the tree using a LIFO stack,
    /// checking if nodes changed, and patching the flat cache if so.
    fn diffAndPatch(
        self: *ValidatorFlatCache,
        old_root: Node.Id,
        new_root: Node.Id,
        depth: usize,
        base: usize,
        old_len: usize,
        new_len: usize,
    ) !void {
        const Frame = struct {
            old: Node.Id,
            new: Node.Id,
            depth: usize,
            /// Index of the first leaf position covered by this subtree.
            /// If the subtree is the leaf itself, then this is the validator index.
            base: usize,
        };

        var stack: BoundedArray(Frame, max_depth + 1) = .{};

        // Start: base of the tree
        stack.push(.{ .old = old_root, .new = new_root, .depth = depth, .base = base });

        while (stack.pop()) |f| {
            // Subtrees starting at new_len or later contain no live validators
            if (f.base >= new_len) continue;

            // index just past the last validator this subtree covers
            const end = f.base + (@as(usize, 1) << @intCast(f.depth));
            if (
            // old tree and new tree shares same node
            f.old == f.new and
                // every index before under old_len was already cached
                end <= old_len) continue;

            if (f.depth == 0) {
                // At a leaf, base is the validator index to patch
                try self.patch(f.base, f.new);
                continue;
            }

            // Each child covers half of the current subtree's validator indexes
            const half = @as(usize, 1) << @intCast(f.depth - 1);

            // Push right first so the LIFO stack processes left first.
            stack.push(.{
                .old = try f.old.getRight(self.pool),
                .new = try f.new.getRight(self.pool),
                .depth = f.depth - 1,
                .base = f.base + half,
            });
            stack.push(.{
                .old = try f.old.getLeft(self.pool),
                .new = try f.new.getLeft(self.pool),
                .depth = f.depth - 1,
                .base = f.base,
            });
        }
    }

    /// Patches the cache at index `i` with validator values from the tree at `leaf`.
    fn patch(self: *ValidatorFlatCache, i: usize, leaf: Node.Id) !void {
        const v = try Validator.tree.getValuePtr(leaf, self.pool);
        self.fields.set(i, .fromValidator(v));
        self.last_patched += 1;
    }
};

test {
    _ = @import("validator_flat_cache_test.zig");
}
