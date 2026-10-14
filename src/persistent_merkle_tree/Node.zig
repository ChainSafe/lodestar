//! Merkle node backed by a memory pool.
//!
//! This file IS the node: top-level fields become per-node SoA columns via
//! `MultiArrayList(@This())`. Variants are distinguished by `state.kind()`.
//!
//! Layout (3 columns total):
//!   - `payload`: u64, overloaded by kind
//!       branch        : low 32 = left Id,  high 32 = right Id
//!       chunked_leaf          : full 64-bit `*ChunkedLeaf` pointer
//!       container_struct : full 64-bit `*ContainerStructRef` pointer
//!       free          : low 32 = next-free Id (high 32 unused)
//!       zero/leaf     : unused (zero/leaf root lives in `root`)
//!   - `root`:  [32]u8 — leaf bytes, zero hash, or cached subtree root
//!     (`lazy_sentinel` = uncomputed for branch/chunked_leaf/container_struct)
//!   - `state`: State (packed u32 — see `State` doc)
//!
//! Maximum compactness: kind+ref_count packed into one u32 (`State`), and
//! `left`+`right`+`cache` collapse into one u64 (`payload`). Branch
//! navigation reads exactly two columns per visit (state + payload).
const std = @import("std");
const builtin = @import("builtin");
const Allocator = std.mem.Allocator;

const hashOne = @import("hashing").hashOne;
const getZeroHash = @import("hashing").getZeroHash;
const max_depth = @import("hashing").max_depth;
const Depth = @import("hashing").Depth;
const Gindex = @import("gindex.zig").Gindex;
const ChunkedLeaf = @import("ChunkedLeaf.zig");

// Flat node fields (file-as-struct). Order doesn't affect SoA layout.
payload: u64,
root: [32]u8,
state: State,

const Node = @This();

pub const Error = error{
    /// Attempt to access a child of a node that is not a branch node.
    InvalidNode,
    /// Attempt to use a length beyond the tree's length at a given depth.
    InvalidLength,
    /// The configured pool size cannot be represented by the free list.
    InvalidPoolCapacity,
    /// Attempt to increment the reference count beyond `max_ref_count`.
    RefCountOverflow,
    /// The fixed-capacity pool has no free user slots.
    PoolExhausted,
    /// Out of memory.
    OutOfMemory,
};

/// Maximum reference count an in-use node may hold.
///
/// `State` packs ref_count into 28 bits, so the saturating sentinel is the
/// largest 28-bit value.
pub const max_ref_count: u32 = State.rc_mask;

/// Variant tag exposed to callers. The encoded form lives inside `State`'s
/// 3-bit kind field; `.free` is special — encoded as `state.isFree()` (the
/// high bit) rather than as a 3-bit value, so the in-use kinds occupy
/// values 1..5 and the 3-bit slot stores `tag - 1`.
pub const NodeKind = enum(u8) {
    free = 0,
    zero = 1,
    leaf = 2,
    branch = 3,
    chunked_leaf = 4,
    container_struct = 5,
};

/// Packed `[ free_bit | kind:3 | ref_count:28 ]` (in-use) or
/// `[ free_bit | next_free:31 ]` (free).
pub const State = enum(u32) {
    _,

    pub const free_bit: u32 = 0x8000_0000;
    pub const next_free_mask: u32 = 0x7FFF_FFFF;
    pub const kind_shift: u5 = 28;
    pub const kind_field_mask: u32 = 0x7000_0000;
    pub const rc_mask: u32 = 0x0FFF_FFFF;

    pub inline fn isFree(s: State) bool {
        return @intFromEnum(s) & free_bit != 0;
    }
    pub inline fn isZero(s: State) bool {
        return s.kind() == .zero;
    }
    pub inline fn isLeaf(s: State) bool {
        return s.kind() == .leaf;
    }
    pub inline fn isBranch(s: State) bool {
        return s.kind() == .branch;
    }
    pub inline fn isChunkedLeaf(s: State) bool {
        return s.kind() == .chunked_leaf;
    }
    pub inline fn isContainerStruct(s: State) bool {
        return s.kind() == .container_struct;
    }

    /// Branch-free decode: free → NodeKind(0)=.free, in-use → NodeKind(enc+1).
    pub inline fn kind(s: State) NodeKind {
        const raw = @intFromEnum(s);
        const is_in_use: u32 = @intFromBool((raw & free_bit) == 0);
        const enc: u32 = (raw & kind_field_mask) >> kind_shift;
        return @enumFromInt(@as(u8, @intCast(is_in_use * (enc + 1))));
    }

    pub inline fn refCount(s: State) u32 {
        std.debug.assert(!s.isFree());
        return @intFromEnum(s) & rc_mask;
    }

    pub inline fn nextFree(s: State) Id {
        std.debug.assert(s.isFree());
        return @enumFromInt(@intFromEnum(s) & next_free_mask);
    }

    pub inline fn initFree(next: Id) State {
        std.debug.assert(@intFromEnum(next) <= next_free_mask);
        return @enumFromInt(free_bit | @intFromEnum(next));
    }

    pub inline fn initInUse(k: NodeKind, rc: u32) State {
        std.debug.assert(k != .free);
        std.debug.assert(rc <= rc_mask);
        const enc: u32 = (@as(u32, @intFromEnum(k)) - 1) << kind_shift;
        return @enumFromInt(enc | rc);
    }

    /// Replaces the kind tag while preserving the ref count.
    pub inline fn setKind(s: *State, k: NodeKind) void {
        std.debug.assert(!s.isFree());
        std.debug.assert(k != .free);
        const enc: u32 = (@as(u32, @intFromEnum(k)) - 1) << kind_shift;
        s.* = @enumFromInt((@intFromEnum(s.*) & rc_mask) | enc);
    }

    pub inline fn incRefCount(s: *State) Error!u32 {
        std.debug.assert(!s.isFree());
        const rc = s.refCount();
        if (rc == rc_mask) return error.RefCountOverflow;
        s.* = @enumFromInt(@intFromEnum(s.*) + 1);
        return rc + 1;
    }

    pub inline fn decRefCount(s: *State) u32 {
        std.debug.assert(!s.isFree());
        const rc = s.refCount();
        if (rc == 0) return 0;
        s.* = @enumFromInt(@intFromEnum(s.*) - 1);
        return rc - 1;
    }
};

/// Vtable + struct pointer that backs every `.container_struct` Node.
///
/// The Pool owns this allocation. `ptr` is an opaque-typed pointer to a
/// caller-supplied wrapped struct that implements the required methods:
///   - `init(allocator, *const T) Error!*const T` — clone the struct into the pool
///   - `deinit(allocator) void` — free the cloned struct
///   - `getRoot(out: *[32]u8) void` — compute the merkle root from cached fields
///   - `toTree(pool: *Pool) Error!Id` — materialize a temporary, fully-navigable
///     PMT subtree from the cached struct so that proof traversal can walk
///     into the container's interior. The returned Id is owned by the caller
///     (typically created with refcount=0 by the underlying field-tree
///     constructors); the proof code wraps it with `pool.unref` on cleanup.
pub const ContainerStructRef = struct {
    ptr: *anyopaque,
    get_root: *const fn (ptr: *const anyopaque, out: *[32]u8) void,
    to_tree: *const fn (ptr: *const anyopaque, pool: *Pool) Error!Id,
    deinit: *const fn (ptr: *anyopaque, allocator: Allocator) void,
};

/// Sentinel value marking an uncomputed root cache on `branch`,
/// `chunked_leaf`, and `container_struct` slots. Equality with this value
/// means "lazy — recompute on next getRoot"; any other 32-byte value
/// is treated as the cached merkle root.
///
/// All-`0xFF` is safe because cryptographic SHA-256 outputs collide
/// with this value at probability ~1/2^256.
///
/// Kept in the root column rather than in `State.kind` so the lazy/computed
/// flag is independent of node kind. `getRoot` flips it by writing only the
/// root column, leaving `state` untouched.
pub const lazy_sentinel: [32]u8 = [_]u8{0xFF} ** 32;

/// Pack a `(left, right)` Id pair into the u64 `payload` field.
/// Convention: `left` low 32 bits, `right` high 32 bits.
inline fn packChildren(left: Id, right: Id) u64 {
    return @as(u64, @intFromEnum(left)) | (@as(u64, @intFromEnum(right)) << 32);
}

/// Decode the left child Id from a packed `payload`.
inline fn unpackLeft(p: u64) Id {
    return @enumFromInt(@as(u32, @truncate(p)));
}

/// Decode the right child Id from a packed `payload`.
inline fn unpackRight(p: u64) Id {
    return @enumFromInt(@as(u32, @intCast(p >> 32)));
}

/// Reinterpret a `payload` as a heap pointer (chunked_leaf / container_struct).
inline fn payloadAsPtr(p: u64) *anyopaque {
    return @ptrFromInt(p);
}

/// Encode a heap pointer as a `payload` value.
inline fn ptrAsPayload(ptr: *anyopaque) u64 {
    return @intFromPtr(ptr);
}

/// Pair of child Ids. Always defined when `noChild` is false.
const Children = struct { left: Id, right: Id };

/// Resolve the (left, right) child Ids for a navigable node.
inline fn childrenOf(
    node_id: Id,
    kind: NodeKind,
    payloads: []const u64,
) Children {
    const idx = @intFromEnum(node_id);
    return switch (kind) {
        .branch => blk: {
            const p = payloads[idx];
            break :blk .{ .left = unpackLeft(p), .right = unpackRight(p) };
        },
        .zero => blk: {
            std.debug.assert(idx >= 1);
            const prev: Id = @enumFromInt(idx - 1);
            break :blk .{ .left = prev, .right = prev };
        },
        // `noChild` guards prevent reaching here for these variants.
        .leaf, .free, .chunked_leaf, .container_struct => unreachable,
    };
}

/// Inline helper: returns true if navigation to a child is impossible.
inline fn noChildKind(node_id: Id, kind: NodeKind) bool {
    return switch (kind) {
        .leaf,
        .free,
        .chunked_leaf,
        .container_struct,
        => true,
        .zero, .branch => @intFromEnum(node_id) == 0,
    };
}

/// Decode the `*ChunkedLeaf` payload pointer for a slot known to be
/// `.chunked_leaf`. Caller is responsible for the kind check.
inline fn chunkedLeafPtr(payloads: []const u64, idx: u32) *ChunkedLeaf {
    return @ptrCast(@alignCast(payloadAsPtr(payloads[idx])));
}

/// Read the ContainerStructRef for a slot known to be `.container_struct`.
inline fn containerStructRef(payloads: []const u64, idx: u32) *ContainerStructRef {
    return @ptrCast(@alignCast(payloadAsPtr(payloads[idx])));
}

/// Stores nodes in a fixed-capacity memory pool, with reference counting and a free list.
pub const Pool = struct {
    page_allocator: Allocator,
    allocator: Allocator,
    nodes: std.MultiArrayList(Node).Slice,
    next_free_node: Id,
    nodes_in_use: usize,
    // Reused scratch for chunked_leaf root recompute: single-threaded, and chunked_leaf is a leaf
    // of getRoot's traversal, so at most one computeRoot uses it at a time.
    chunked_leaf_scratch: [ChunkedLeaf.K / 2][32]u8 align(64),

    pub const InitOptions = struct {
        page_allocator: Allocator = std.heap.page_allocator,
        // Pure-Zig default keeps the pool libc-free; hot paths pin c_allocator.
        allocator: Allocator = std.heap.smp_allocator,
        /// Usable user slots. The zero-hash sentinels are allocated in addition.
        pool_size: u32,
    };

    pub fn init(opts: InitOptions) Error!Pool {
        const total_capacity = std.math.add(u32, opts.pool_size, max_depth) catch {
            return error.InvalidPoolCapacity;
        };
        if (total_capacity > State.next_free_mask) {
            return error.InvalidPoolCapacity;
        }

        var pool: Pool = .{
            .page_allocator = opts.page_allocator,
            .allocator = opts.allocator,
            .nodes = undefined,
            .next_free_node = @enumFromInt(max_depth),
            .nodes_in_use = max_depth,
            .chunked_leaf_scratch = undefined,
        };

        var list = std.MultiArrayList(Node).empty;
        try list.setCapacity(opts.page_allocator, total_capacity);
        list.len = total_capacity;
        pool.nodes = list.slice();
        std.debug.assert(pool.nodes.capacity == total_capacity);

        // Pre-populate zero-hash sentinels at indices 0..max_depth-1.
        for (0..max_depth) |i| {
            pool.nodes.set(@intCast(i), .{
                .payload = 0,
                .root = getZeroHash(@intCast(i)).*,
                .state = State.initInUse(.zero, 0),
            });
        }

        // Initialize the free list across the user slots. `state` carries
        // kind=free + next_free link in the low 31 bits; `payload`/`root`
        // are unused for free slots.
        const state_col = pool.nodes.items(.state);
        for (max_depth..pool.nodes.len) |i| {
            const next: Id = @enumFromInt(@as(u32, @intCast(i + 1)));
            state_col[i] = State.initFree(next);
        }

        return pool;
    }

    pub fn deinit(self: *Pool) void {
        // Release heap payloads owned by `.chunked_leaf` and `.container_struct` slots.
        // The MultiArrayList only owns its own column buffers; payload
        // pointers are heap-allocated separately and become unreachable
        // when callers tear down the pool without first unref'ing every
        // root.
        const states = self.nodes.items(.state);
        const payloads = self.nodes.items(.payload);
        for (states, 0..) |s, i| {
            if (s.isFree()) continue;
            const idx: u32 = @intCast(i);
            switch (s.kind()) {
                .chunked_leaf => self.allocator.destroy(chunkedLeafPtr(payloads, idx)),
                .container_struct => {
                    const struct_ref = containerStructRef(payloads, idx);
                    struct_ref.deinit(struct_ref.ptr, self.allocator);
                    self.allocator.destroy(struct_ref);
                },
                else => {},
            }
        }
        var list = self.nodes.toMultiArrayList();
        list.deinit(self.page_allocator);
        self.* = undefined;
    }

    /// Returns the number of nodes currently in use (not free).
    pub fn getNodesInUse(self: *const Pool) usize {
        if (builtin.is_test) {
            var actual: usize = 0;
            for (self.nodes.items(.state)) |state| {
                if (!state.isFree()) actual += 1;
            }
            std.debug.assert(actual == self.nodes_in_use);
        }
        return self.nodes_in_use;
    }

    /// Pop the next free slot from the free list. Caller must initialise
    /// the returned slot.
    inline fn createUnsafe(self: *Pool) Id {
        const n: Id = self.next_free_node;
        const idx = @intFromEnum(n);
        std.debug.assert(idx < self.nodes.len);
        const state_col = self.nodes.items(.state);
        std.debug.assert(state_col[idx].isFree());
        self.next_free_node = state_col[idx].nextFree();
        self.nodes_in_use += 1;
        return n;
    }

    fn create(self: *Pool) error{PoolExhausted}!Id {
        std.debug.assert(@intFromEnum(self.next_free_node) <= self.nodes.len);
        if (@intFromEnum(self.next_free_node) == self.nodes.len) {
            return error.PoolExhausted;
        }
        return self.createUnsafe();
    }

    pub fn createLeaf(self: *Pool, hash: *const [32]u8) error{PoolExhausted}!Id {
        const node_id = try self.create();
        const idx = @intFromEnum(node_id);
        self.nodes.items(.root)[idx] = hash.*;
        self.nodes.items(.state)[idx] = State.initInUse(.leaf, 0);
        return node_id;
    }

    pub fn createLeafFromUint(self: *Pool, uint: u256) error{PoolExhausted}!Id {
        var hash: [32]u8 = undefined;
        std.mem.writeInt(u256, &hash, uint, .little);
        return self.createLeaf(&hash);
    }

    pub fn createBranch(self: *Pool, left_id: Id, right_id: Id) Error!Id {
        std.debug.assert(@intFromEnum(left_id) < self.nodes.len);
        std.debug.assert(@intFromEnum(right_id) < self.nodes.len);
        std.debug.assert(!self.nodes.items(.state)[@intFromEnum(left_id)].isFree());
        std.debug.assert(!self.nodes.items(.state)[@intFromEnum(right_id)].isFree());

        // Acquire both child refs BEFORE writing parent metadata. If
        // `refUnsafe(right)` fails we mustn't leave the parent slot in
        // `.branch` pointing at a child whose rc was never incremented;
        // a later `unref(parent)` would then recursively dec the
        // un-ref'd child.
        try self.refUnsafe(left_id);
        errdefer self.unrefUnsafe(left_id);
        try self.refUnsafe(right_id);
        errdefer self.unrefUnsafe(right_id);

        const node_id = try self.create();
        const idx = @intFromEnum(node_id);
        self.nodes.items(.state)[idx] = State.initInUse(.branch, 0);
        self.nodes.items(.payload)[idx] = packChildren(left_id, right_id);
        self.nodes.items(.root)[idx] = lazy_sentinel;
        return node_id;
    }

    /// Creates a chunked_leaf Node owning a heap-allocated `ChunkedLeaf` initialized
    /// from `chunks`. `len` is the count of valid chunks (`<= K`); the caller
    /// is responsible for ensuring chunks at indices `>= len` are zero-bytes
    /// (the chunked_leaf trailing-zero invariant). The returned Node has a
    /// lazy root; `Id.getRoot` will compute and cache it on first access.
    pub fn createChunkedLeaf(self: *Pool, chunks: *align(64) const [ChunkedLeaf.K][32]u8, len: u16) Error!Id {
        std.debug.assert(len <= ChunkedLeaf.K);
        const storage = try self.allocator.create(ChunkedLeaf);
        errdefer self.allocator.destroy(storage);

        storage.chunks = chunks.*;
        storage.len = len;

        const node_id = try self.create();
        const idx = @intFromEnum(node_id);
        self.nodes.items(.payload)[idx] = ptrAsPayload(@ptrCast(storage));
        self.nodes.items(.root)[idx] = lazy_sentinel;
        self.nodes.items(.state)[idx] = State.initInUse(.chunked_leaf, 0);
        return node_id;
    }

    /// Creates a chunked_leaf Node owning a freshly-zeroed heap-allocated
    /// `ChunkedLeaf`. Caller fills via `Id.getChunkedLeafPtr`.
    pub fn createChunkedLeafEmpty(self: *Pool, len: u16) Error!Id {
        std.debug.assert(len <= ChunkedLeaf.K);
        const storage = try self.allocator.create(ChunkedLeaf);
        errdefer self.allocator.destroy(storage);

        @memset(std.mem.asBytes(&storage.chunks), 0);
        storage.len = len;

        const node_id = try self.create();
        const idx = @intFromEnum(node_id);
        self.nodes.items(.payload)[idx] = ptrAsPayload(@ptrCast(storage));
        self.nodes.items(.root)[idx] = lazy_sentinel;
        self.nodes.items(.state)[idx] = State.initInUse(.chunked_leaf, 0);
        return node_id;
    }

    /// Create a `.container_struct` Node holding a cloned `T` instance.
    ///
    /// `T` must implement:
    ///   - `pub fn init(allocator: Allocator, *const T) Error!*const T`
    ///   - `pub fn deinit(*T, allocator: Allocator) void`
    ///   - `pub fn getRoot(*const T, out: *[32]u8) void`
    ///
    /// The Pool clones `ptr` (so the caller retains ownership of its copy) and
    /// owns the resulting `ContainerStructRef`. The returned Node has a lazy root;
    /// `Id.getRoot` computes and caches it on first access.
    pub fn createContainerStruct(self: *Pool, comptime T: type, ptr: *const T) Error!Id {
        const cloned = try T.init(self.allocator, ptr);
        errdefer @constCast(cloned).deinit(self.allocator);

        const ref_ptr = try self.allocator.create(ContainerStructRef);
        errdefer self.allocator.destroy(ref_ptr);

        ref_ptr.* = .{
            .ptr = @ptrCast(@constCast(cloned)),
            .get_root = struct {
                fn call(erased: *const anyopaque, out: *[32]u8) void {
                    const typed: *const T = @ptrCast(@alignCast(erased));
                    T.getRoot(typed, out);
                }
            }.call,
            .to_tree = struct {
                fn call(erased: *const anyopaque, p: *Pool) Error!Id {
                    const typed: *const T = @ptrCast(@alignCast(erased));
                    return try T.toTree(typed, p);
                }
            }.call,
            .deinit = struct {
                fn call(erased: *anyopaque, allocator: Allocator) void {
                    const typed: *T = @ptrCast(@alignCast(erased));
                    T.deinit(typed, allocator);
                }
            }.call,
        };

        const node_id = try self.create();
        const idx = @intFromEnum(node_id);
        // `payload` carries the encoded `*ContainerStructRef`; this slot has
        // no Id-children (`noChild` returns true for container_struct).
        self.nodes.items(.payload)[idx] = ptrAsPayload(@ptrCast(ref_ptr));
        self.nodes.items(.root)[idx] = lazy_sentinel;
        self.nodes.items(.state)[idx] = State.initInUse(.container_struct, 0);
        return node_id;
    }

    /// Returns a read-only pointer to the wrapped struct held by a
    /// `.container_struct` Node. Returns `error.InvalidNode` if the slot is not
    /// a branch-struct variant.
    pub fn getStructPtr(self: *Pool, node_id: Id, comptime T: type) Error!*const T {
        const idx = @intFromEnum(node_id);
        if (self.nodes.items(.state)[idx].kind() != .container_struct) {
            return error.InvalidNode;
        }
        const ref_ptr = containerStructRef(self.nodes.items(.payload), idx);
        return @ptrCast(@alignCast(ref_ptr.ptr));
    }

    /// Materializes a temporary, fully-navigable PMT subtree from a
    /// `.container_struct` slot's wrapped struct. The returned Id has refcount
    /// matching the underlying field-tree constructors (typically 0 — caller
    /// is responsible for `unref`'ing it once the temporary tree is no longer
    /// needed). Returns `error.InvalidNode` if the slot is not a branch-struct
    /// variant.
    pub fn materializeContainerStruct(self: *Pool, node_id: Id) Error!Id {
        const idx = @intFromEnum(node_id);
        if (self.nodes.items(.state)[idx].kind() != .container_struct) {
            return error.InvalidNode;
        }
        const ref_ptr = containerStructRef(self.nodes.items(.payload), idx);
        return try ref_ptr.to_tree(ref_ptr.ptr, self);
    }

    /// Materializes a temporary, fully-navigable PMT subtree from a `.chunked_leaf`
    /// slot's K packed chunks. The chunked_leaf represents a depth-`ChunkedLeaf.k_log2`
    /// subtree of leaves; this builds it explicitly so that proof traversal
    /// can walk into individual chunks. Trailing zero subtrees fill the chunked_leaf
    /// to full K. The returned Id has refcount=0; caller is responsible for
    /// `unref`'ing it. Returns `error.InvalidNode` if the slot is not a chunked_leaf.
    pub fn materializeChunkedLeaf(self: *Pool, node_id: Id) Error!Id {
        const idx = @intFromEnum(node_id);
        if (self.nodes.items(.state)[idx].kind() != .chunked_leaf) {
            return error.InvalidNode;
        }
        const storage = chunkedLeafPtr(self.nodes.items(.payload), idx);

        // Build a depth-k_log2 perfect tree spanning all K chunks. We always
        // emit K leaves (even those at indices >= storage.len, which are
        // guaranteed to be zero-bytes by the trailing-zero invariant) so
        // that the resulting subtree's root matches the chunked_leaf's
        // `computeRoot` exactly.
        var it = SubtreeBuilder.init(self, ChunkedLeaf.k_log2);
        errdefer it.deinit();
        for (0..ChunkedLeaf.K) |i| {
            const leaf = try self.createLeaf(&storage.chunks[i]);
            try it.append(leaf);
        }
        return try it.finish();
    }

    /// Allocates nodes into the pool.
    ///
    /// All nodes are allocated with refcount=0.
    /// Nodes allocated here are expected to be attached via `rebind`.
    pub fn alloc(self: *Pool, out: []Id) error{PoolExhausted}!void {
        for (0..out.len) |i| {
            std.debug.assert(@intFromEnum(self.next_free_node) <= self.nodes.len);
            if (@intFromEnum(self.next_free_node) == self.nodes.len) {
                const states = self.nodes.items(.state);
                for (out[0..i]) |node_id| {
                    states[@intFromEnum(node_id)] = State.initFree(self.next_free_node);
                    self.next_free_node = node_id;
                    self.nodes_in_use -= 1;
                }
                return error.PoolExhausted;
            }
            out[i] = self.createUnsafe();

            // Initialize as a lazy branch with zero(0) children so that any
            // errdefer-driven cleanup walks safely. Caller is expected to
            // overwrite via `rebind`.
            const idx = @intFromEnum(out[i]);
            self.nodes.items(.payload)[idx] = 0;
            self.nodes.items(.root)[idx] = lazy_sentinel;
            self.nodes.items(.state)[idx] = State.initInUse(.branch, 0);
        }
    }

    /// Unrefs each node in `out`.
    pub fn free(self: *Pool, out: []Id) void {
        for (out) |node_id| {
            self.unref(node_id);
        }
    }

    /// Rebinds nodes in the pool.
    ///
    /// It is assumed that `out` nodes have been freshly allocated and are not referenced elsewhere.
    pub fn rebind(self: *Pool, out: []Id, left_ids: []Id, right_ids: []Id) Error!void {
        std.debug.assert(out.len == left_ids.len);
        std.debug.assert(out.len == right_ids.len);

        const state_col = self.nodes.items(.state);
        const payload_col = self.nodes.items(.payload);
        const root_col = self.nodes.items(.root);

        for (0..out.len) |i| {
            const idx = @intFromEnum(out[i]);
            std.debug.assert(idx < self.nodes.len);

            // Acquire both child refs BEFORE writing parent metadata. If
            // `refUnsafe(right)` fails we mustn't leave the parent slot in
            // `.branch` pointing at a child whose rc was never incremented;
            // a later `unref(parent)` would then recursively dec the
            // un-ref'd child. Note: parent's own rc is preserved — an
            // earlier iteration may have already ref'd this slot (when
            // out[i] is the child of an earlier out[j]).
            try self.refUnsafe(left_ids[i]);
            errdefer self.unref(left_ids[i]);
            try self.refUnsafe(right_ids[i]);
            errdefer self.unref(right_ids[i]);

            state_col[idx].setKind(.branch);
            payload_col[idx] = packChildren(left_ids[i], right_ids[i]);
            root_col[idx] = lazy_sentinel;
        }
    }

    pub fn ref(self: *Pool, node_id: Id) Error!void {
        if (@intFromEnum(node_id) >= self.nodes.len) return;
        if (self.nodes.items(.state)[@intFromEnum(node_id)].isFree()) return;
        try self.refUnsafe(node_id);
    }

    /// Increment the reference count. Assumes `node_id` is in bounds and not free.
    fn refUnsafe(self: *Pool, node_id: Id) Error!void {
        const s = &self.nodes.items(.state)[@intFromEnum(node_id)];
        if (s.kind() == .zero) return;
        _ = try s.incRefCount();
    }

    /// Exact inverse of `refUnsafe`: drop the ref it took WITHOUT freeing at
    /// rc 0. On a failed multi-ref acquire (e.g. createBranch) or a partially
    /// built view, this restores a freshly-ref'd rc-0 orphan to its pre-call
    /// allocated state so the caller can still reclaim it; `unref` would free
    /// it and cause a double-free.
    pub fn unrefUnsafe(self: *Pool, node_id: Id) void {
        const s = &self.nodes.items(.state)[@intFromEnum(node_id)];
        if (s.kind() == .zero) return;
        _ = s.decRefCount();
    }

    pub fn unref(self: *Pool, node_id: Id) void {
        var stack: [max_depth]Id = undefined;
        var current: ?Id = node_id;
        var sp: Depth = 0;

        while (true) {
            const id = current orelse {
                if (sp == 0) {
                    break;
                }
                sp -= 1;
                current = stack[sp];
                continue;
            };

            // Continue if the node is out of bounds.
            if (@intFromEnum(id) >= self.nodes.len) {
                current = null;
                continue;
            }

            const states = self.nodes.items(.state);
            const k = states[@intFromEnum(id)].kind();

            // Rollback errdefers unref the same spine twice (via node_id and
            // path_parents); tolerate the already-freed slot, don't panic.
            if (k == .free) {
                current = null;
                continue;
            }
            // Zero nodes are not ref counted; nothing to do.
            if (k == .zero) {
                current = null;
                continue;
            }

            // Decrement the reference count, saturating at zero. A node at
            // rc==0 (freshly created and never additionally ref'd) still
            // gets freed on unref (legacy semantics).
            const new_rc = states[@intFromEnum(id)].decRefCount();

            if (new_rc != 0) {
                current = null;
                continue;
            }

            // Reached zero: traverse children before freeing the slot.
            switch (k) {
                .branch => {
                    const c = self.nodes.items(.payload)[@intFromEnum(id)];
                    stack[sp] = unpackRight(c);
                    sp += 1;
                    current = unpackLeft(c);
                },
                .chunked_leaf => {
                    const storage = chunkedLeafPtr(self.nodes.items(.payload), @intFromEnum(id));
                    self.allocator.destroy(storage);
                    current = null;
                },
                .container_struct => {
                    // Free the wrapped struct + the ContainerStructRef heap-allocation.
                    const ref_ptr = containerStructRef(self.nodes.items(.payload), @intFromEnum(id));
                    ref_ptr.deinit(ref_ptr.ptr, self.allocator);
                    self.allocator.destroy(ref_ptr);
                    current = null;
                },
                else => {
                    current = null;
                },
            }
            // Return the node to the free list. Free-list link is encoded
            // in `state` (the State.initFree representation).
            states[@intFromEnum(id)] = State.initFree(self.next_free_node);
            self.next_free_node = id;
            self.nodes_in_use -= 1;
        }
    }
};
/// A handle which uniquely identifies the node within a `Pool`.
pub const Id = enum(u32) {
    _,

    /// Returns true if navigation to a child node is impossible at `node`.
    ///
    /// Matches legacy semantics: leaves and `Id(0)` (the depth-0 zero
    /// sentinel) have no navigable children. Zero nodes at depth >= 1
    /// remain navigable — both children point to `zero(d-1)`.
    pub inline fn noChild(node_id: Id, kind: NodeKind) bool {
        return noChildKind(node_id, kind);
    }

    /// Returns the root hash, computing lazy branches with bounded, allocation-free traversal.
    /// Branch paths must be acyclic and contain at most `max_depth` branches.
    /// Traversal-bound violations indicate invalid native tree construction and panic.
    /// Opaque container callbacks retain their own hashing behavior.
    pub fn getRoot(node_id: Id, pool: *Pool) *const [32]u8 {
        const idx = @intFromEnum(node_id);
        const kind = pool.nodes.items(.state)[idx].kind();
        const roots = pool.nodes.items(.root);
        switch (kind) {
            .zero, .leaf => return &roots[idx],
            .free => @panic("getRoot called on .free slot — use-after-free"),
            .branch, .chunked_leaf, .container_struct => {},
        }
        if (std.mem.eql(u8, &roots[idx], &lazy_sentinel)) computeRoot(node_id, pool);
        return &roots[idx];
    }

    fn computeRoot(node_id: Id, pool: *Pool) void {
        const Frame = struct { node: Id, right_visited: bool };
        var stack: [max_depth]Frame = undefined;
        var depth: usize = 0;
        var current = node_id;
        const states = pool.nodes.items(.state);
        const roots = pool.nodes.items(.root);
        const payloads = pool.nodes.items(.payload);

        // Each uncached branch contributes at most two child visits, including shared subtrees.
        var remaining_visits = 2 * @as(u64, pool.nodes.len) + 1;
        while (remaining_visits > 0) : (remaining_visits -= 1) {
            const idx = @intFromEnum(current);
            switch (states[idx].kind()) {
                .zero, .leaf => {},
                .free => @panic("getRoot called on .free slot — use-after-free"),
                .branch => {
                    if (std.mem.eql(u8, &roots[idx], &lazy_sentinel)) {
                        if (depth == max_depth) @panic("getRoot branch path exceeds max_depth");
                        stack[depth] = .{ .node = current, .right_visited = false };
                        depth += 1;
                        current = unpackLeft(payloads[idx]);
                        continue;
                    }
                },
                .chunked_leaf => {
                    if (std.mem.eql(u8, &roots[idx], &lazy_sentinel)) {
                        const storage = chunkedLeafPtr(payloads, idx);
                        var hash: [32]u8 = undefined;
                        storage.computeRoot(&pool.chunked_leaf_scratch, &hash);
                        roots[idx] = hash;
                    }
                },
                .container_struct => {
                    if (std.mem.eql(u8, &roots[idx], &lazy_sentinel)) {
                        const ref_ptr = containerStructRef(payloads, idx);
                        var hash: [32]u8 = undefined;
                        ref_ptr.get_root(ref_ptr.ptr, &hash);
                        roots[idx] = hash;
                    }
                },
            }

            while (depth > 0) {
                const frame = &stack[depth - 1];
                const parent_idx = @intFromEnum(frame.node);
                const children = payloads[parent_idx];
                if (!frame.right_visited) {
                    frame.right_visited = true;
                    current = unpackRight(children);
                    break;
                }
                var hash: [32]u8 = undefined;
                hashOne(&hash, &roots[@intFromEnum(unpackLeft(children))], &roots[@intFromEnum(unpackRight(children))]);
                roots[parent_idx] = hash;
                depth -= 1;
            }
            if (depth == 0) return;
        }
        @panic("getRoot exceeded the pool traversal bound");
    }

    pub fn getLeft(node_id: Id, pool: *Pool) Error!Id {
        const idx = @intFromEnum(node_id);
        const kind = pool.nodes.items(.state)[idx].kind();
        if (noChildKind(node_id, kind)) return error.InvalidNode;
        return childrenOf(node_id, kind, pool.nodes.items(.payload)).left;
    }

    pub fn getRight(node_id: Id, pool: *Pool) Error!Id {
        const idx = @intFromEnum(node_id);
        const kind = pool.nodes.items(.state)[idx].kind();
        if (noChildKind(node_id, kind)) return error.InvalidNode;
        return childrenOf(node_id, kind, pool.nodes.items(.payload)).right;
    }

    pub fn getChunkedLeafChunks(node_id: Id, pool: *Pool) Error!*align(64) const [ChunkedLeaf.K][32]u8 {
        const idx = @intFromEnum(node_id);
        if (pool.nodes.items(.state)[idx].kind() != .chunked_leaf) return error.InvalidNode;
        return &chunkedLeafPtr(pool.nodes.items(.payload), idx).chunks;
    }

    pub fn getChunkedLeafLen(node_id: Id, pool: *Pool) Error!u16 {
        const idx = @intFromEnum(node_id);
        if (pool.nodes.items(.state)[idx].kind() != .chunked_leaf) return error.InvalidNode;
        return chunkedLeafPtr(pool.nodes.items(.payload), idx).len;
    }

    pub fn getChunkedLeafPtr(node_id: Id, pool: *Pool) Error!*ChunkedLeaf {
        const idx = @intFromEnum(node_id);
        if (pool.nodes.items(.state)[idx].kind() != .chunked_leaf) return error.InvalidNode;
        std.debug.assert(pool.nodes.items(.state)[idx].refCount() == 0);
        return chunkedLeafPtr(pool.nodes.items(.payload), idx);
    }

    /// Writes one chunk and invalidates the leaf's cached root without allocating.
    /// Requires reference count zero; `valid_chunks` must preserve or grow the length.
    /// `write` must not retain the chunk pointer or access the pool.
    pub fn editChunkedLeaf(
        node_id: Id,
        pool: *Pool,
        intra_chunk: u16,
        valid_chunks: u16,
        comptime T: type,
        index: usize,
        value: *const T,
        comptime write: fn (*[32]u8, usize, *const T) void,
    ) Error!void {
        std.debug.assert(intra_chunk < valid_chunks);
        std.debug.assert(valid_chunks <= ChunkedLeaf.K);
        const storage = try node_id.getChunkedLeafPtr(pool);
        std.debug.assert(storage.len <= valid_chunks);

        write(&storage.chunks[intra_chunk], index, value);
        storage.len = valid_chunks;
        pool.nodes.items(.root)[@intFromEnum(node_id)] = lazy_sentinel;
    }

    pub fn setChunkedLeafChunk(node_id: Id, pool: *Pool, intra_index: u16, chunk: *const [32]u8) Error!Id {
        std.debug.assert(intra_index < ChunkedLeaf.K);

        const idx = @intFromEnum(node_id);
        if (pool.nodes.items(.state)[idx].kind() != .chunked_leaf) return error.InvalidNode;
        const old_storage = chunkedLeafPtr(pool.nodes.items(.payload), idx);

        const new_storage = try pool.allocator.create(ChunkedLeaf);
        errdefer pool.allocator.destroy(new_storage);

        new_storage.chunks = old_storage.chunks;
        new_storage.len = old_storage.len;
        new_storage.chunks[intra_index] = chunk.*;

        const new_id = try pool.create();
        const new_idx = @intFromEnum(new_id);
        pool.nodes.items(.state)[new_idx] = State.initInUse(.chunked_leaf, 0);
        pool.nodes.items(.payload)[new_idx] = ptrAsPayload(@ptrCast(new_storage));
        pool.nodes.items(.root)[new_idx] = lazy_sentinel;
        return new_id;
    }

    /// Returns a new chunked_leaf `Id` with each `intra_indices[i]` chunk replaced by
    /// `new_chunks[i]`. Heap blob cloned once; all updates applied in-place
    /// in the new blob. Returns `error.InvalidNode` if the receiver is not
    /// a chunked_leaf variant. `intra_indices` and `new_chunks` must have equal length.
    pub fn setChunkedLeafChunks(
        node_id: Id,
        pool: *Pool,
        intra_indices: []const u16,
        new_chunks: []const *const [32]u8,
    ) Error!Id {
        std.debug.assert(intra_indices.len == new_chunks.len);

        const idx = @intFromEnum(node_id);
        if (pool.nodes.items(.state)[idx].kind() != .chunked_leaf) return error.InvalidNode;
        const old_storage = chunkedLeafPtr(pool.nodes.items(.payload), idx);

        const new_storage = try pool.allocator.create(ChunkedLeaf);
        errdefer pool.allocator.destroy(new_storage);

        new_storage.chunks = old_storage.chunks;
        new_storage.len = old_storage.len;

        for (intra_indices, new_chunks) |i, ptr| {
            std.debug.assert(i < ChunkedLeaf.K);
            new_storage.chunks[i] = ptr.*;
        }

        const new_id = try pool.create();
        const new_idx = @intFromEnum(new_id);
        pool.nodes.items(.state)[new_idx] = State.initInUse(.chunked_leaf, 0);
        pool.nodes.items(.payload)[new_idx] = ptrAsPayload(@ptrCast(new_storage));
        pool.nodes.items(.root)[new_idx] = lazy_sentinel;
        return new_id;
    }

    /// Returns the slot's packed `State`. Call methods on the result
    /// (`isFree()`, `kind()`, `refCount()`, `nextFree()`).
    pub inline fn getState(node_id: Id, pool: *Pool) State {
        return pool.nodes.items(.state)[@intFromEnum(node_id)];
    }

    /// Returns true iff this is a `.branch` slot whose root is still the
    /// lazy sentinel. Lives on `Id` (not `State`) because it needs the
    /// `root` column too.
    pub inline fn isBranchLazy(node_id: Id, pool: *Pool) bool {
        if (node_id.getState(pool).kind() != .branch) return false;
        return std.mem.eql(u8, &pool.nodes.items(.root)[@intFromEnum(node_id)], &lazy_sentinel);
    }

    /// Returns true iff this is a `.branch` slot with a cached (non-lazy) root.
    pub inline fn isBranchComputed(node_id: Id, pool: *Pool) bool {
        if (node_id.getState(pool).kind() != .branch) return false;
        return !std.mem.eql(u8, &pool.nodes.items(.root)[@intFromEnum(node_id)], &lazy_sentinel);
    }

    pub fn getNode(root_node: Id, pool: *Pool, gindex: Gindex) Error!Id {
        if (@intFromEnum(gindex) <= 1) {
            return root_node;
        }

        const path_len = gindex.pathLen();
        var path = gindex.toPath();

        const states = pool.nodes.items(.state);
        const payloads = pool.nodes.items(.payload);

        var node_id: Id = root_node;
        for (0..path_len) |_| {
            const idx = @intFromEnum(node_id);
            const k = states[idx].kind();
            if (noChildKind(node_id, k)) {
                return error.InvalidNode;
            }
            const c = childrenOf(node_id, k, payloads);
            if (path.left()) {
                node_id = c.left;
            } else {
                node_id = c.right;
            }
            path.next();
        }

        return node_id;
    }

    pub fn getNodeAtDepth(root_node: Id, pool: *Pool, depth: Depth, index: usize) Error!Id {
        return try root_node.getNode(
            pool,
            Gindex.fromDepth(depth, index),
        );
    }

    pub fn setNode(root_node: Id, pool: *Pool, gindex: Gindex, node_id: Id) Error!Id {
        if (@intFromEnum(gindex) <= 1) {
            return node_id;
        }

        const path_len = gindex.pathLen();
        var path = gindex.toPath();

        var path_lefts_buf: [max_depth]Id = undefined;
        var path_rights_buf: [max_depth]Id = undefined;
        var path_parents_buf: [max_depth]Id = undefined;

        const path_lefts = path_lefts_buf[0..path_len];
        const path_rights = path_rights_buf[0..path_len];
        const path_parents = path_parents_buf[0..path_len];

        try pool.alloc(path_parents);
        errdefer pool.free(path_parents);

        const states = pool.nodes.items(.state);
        const payloads = pool.nodes.items(.payload);

        var id = root_node;

        for (0..path_len - 1) |i| {
            const idx = @intFromEnum(id);
            const k = states[idx].kind();
            if (noChildKind(id, k)) {
                return error.InvalidNode;
            }
            const c = childrenOf(id, k, payloads);
            if (path.left()) {
                path_lefts[i] = path_parents[i + 1];
                path_rights[i] = c.right;
                id = c.left;
            } else {
                path_lefts[i] = c.left;
                path_rights[i] = path_parents[i + 1];
                id = c.right;
            }
            path.next();
        }

        // final layer
        {
            const idx = @intFromEnum(id);
            const k = states[idx].kind();
            if (noChildKind(id, k)) {
                return error.InvalidNode;
            }
            const c = childrenOf(id, k, payloads);
            if (path.left()) {
                path_lefts[path_len - 1] = node_id;
                path_rights[path_len - 1] = c.right;
            } else {
                path_lefts[path_len - 1] = c.left;
                path_rights[path_len - 1] = node_id;
            }
        }

        try pool.rebind(
            path_parents,
            path_lefts,
            path_rights,
        );

        return path_parents[0];
    }

    pub fn setNodeAtDepth(root_node: Id, pool: *Pool, depth: Depth, index: usize, node_id: Id) Error!Id {
        return try root_node.setNode(
            pool,
            Gindex.fromDepth(depth, index),
            node_id,
        );
    }

    /// Get multiple nodes in a single traversal.
    ///
    /// Stores `out.len` nodes at the specified `depth`, starting from `start_index`.
    pub fn getNodesAtDepth(root_node: Id, pool: *Pool, depth: Depth, start_index: usize, out: []Id) Error!void {
        std.debug.assert(out.len > 0);

        const base_gindex = Gindex.fromDepth(depth, 0);

        if (@intFromEnum(base_gindex) <= 1) {
            out[0] = root_node;
            return;
        }

        const path_len = base_gindex.pathLen();
        var parents_buf: [max_depth]Id = undefined;

        var node_id = root_node;
        var diffi = depth;

        const states = pool.nodes.items(.state);
        const payloads = pool.nodes.items(.payload);

        // For each index specified
        for (0..out.len) |i| {
            // Calculate the gindex bits for the current index
            const index = start_index + i;
            const gindex: Gindex = @enumFromInt(@as(Gindex.Uint, @intCast(@intFromEnum(base_gindex) | index)));
            const d = path_len - diffi;

            var path = gindex.toPath();
            path.nextN(d);

            // Navigate down (from the depth diff) to the current index, populating parents
            for (d..path_len) |bit_i| {
                const idx = @intFromEnum(node_id);
                const k = states[idx].kind();
                if (noChildKind(node_id, k)) {
                    return error.InvalidNode;
                }
                const c = childrenOf(node_id, k, payloads);
                parents_buf[bit_i] = node_id;
                if (path.left()) {
                    node_id = c.left;
                } else {
                    node_id = c.right;
                }
                path.next();
            }

            // Populate the output
            out[i] = node_id;

            // Calculate the depth diff to navigate from current index to the next
            // This is always gt 0 (unless an index is repeated)
            diffi = if (i == out.len - 1)
                depth
            else
                @intCast(@bitSizeOf(Gindex) - @clz(index ^ index + 1));

            // Navigate upwards depth diff times
            node_id = parents_buf[path_len - diffi];
        }
    }

    /// Set multiple nodes in batch, editing and traversing nodes strictly once.
    /// - indexes MUST be sorted in ascending order beforehand.
    /// - All indexes must be at the exact same depth.
    /// - Depth must be > 0, if 0 just replace the root node.
    pub fn setNodesAtDepth(root_node: Id, pool: *Pool, depth: Depth, indices: []const usize, nodes_in: []Id) Error!Id {
        std.debug.assert(nodes_in.len == indices.len);
        if (indices.len == 0) {
            return root_node;
        }
        // Callers must pass strictly-ascending indices; unsorted or duplicate input silently
        // corrupts the tree. assert is a no-op in unsafe builds, so the loop is optimized away
        // there; keep it after the empty guard, since `for (1..0)` would panic.
        for (1..indices.len) |k| std.debug.assert(indices[k - 1] < indices[k]);

        const base_gindex = Gindex.fromDepth(depth, 0);

        if (@intFromEnum(base_gindex) <= 1) {
            return nodes_in[0];
        }

        const path_len = base_gindex.pathLen();

        // Zero-filled so that if a later iteration errors, the errdefer's free skips the
        // not-yet-filled slots (freeing a zero id is a no-op) instead of unref-ing garbage.
        var path_parents_buf: [max_depth]Id = @splat(@as(Id, @enumFromInt(0)));
        // at each level, there is at most 1 unfinalized parent per traversal
        // "unfinalized" means it may or may not be part of the new tree.
        // Must start all-null: the cleanup loop reads slots for right-moves it never wrote this
        // pass, and an undefined `?Id` could look non-null and unref a garbage Id.
        var unfinalized_parents_buf: [max_depth]?Id = @splat(null);
        var path_lefts_buf: [max_depth]Id = undefined;
        var path_rights_buf: [max_depth]Id = undefined;
        // right_move means it's part of the new tree, it happens when we traverse right
        var right_move: [max_depth]bool = undefined;

        const path_parents = path_parents_buf[0..path_len];
        const path_lefts = path_lefts_buf[0..path_len];
        const path_rights = path_rights_buf[0..path_len];

        var node_id = root_node;
        errdefer {
            // at any points, node_id is the root of the in-progress new tree
            if (node_id != root_node) pool.unref(node_id);
            // orphaned nodes were unrefed along the way through unfinalized_parents_buf
            // path_parents may or maynot be part of the in-progress new tree, there is no issue to double unref()
            pool.free(path_parents);
        }

        // The shared depth between the previous and current index
        // This is initialized as 0 since the first index has no previous index
        var d_offset: Depth = 0;

        const states = pool.nodes.items(.state);
        const payloads = pool.nodes.items(.payload);

        // For each index specified, maintain/update path_lefts and path_rights from root (depth 0) all the way to path_len
        // but only allocate and update path_parents from the next shared depth to path_len
        for (0..indices.len) |i| {
            // Calculate the gindex bits for the current index
            const index = indices[i];
            const gindex: Gindex = @enumFromInt(@as(Gindex.Uint, @intCast(@intFromEnum(base_gindex) | index)));

            // Calculate the depth offset to navigate from current index to the next
            const next_d_offset = if (i == indices.len - 1)
                // 0 because there is no next index, it also means node_id is now the new root
                0
            else
                path_len - @as(Depth, @intCast(@bitSizeOf(usize) - @clz(index ^ indices[i + 1])));
            try pool.alloc(path_parents[next_d_offset..path_len]);

            var path = gindex.toPath();

            // Navigate down (to the depth offset), attaching any new updates
            // d_offset is the shared depth between the previous and current index so we can reuse path_lefts and path_rights up that point
            // but update them to the path_parents to rebind starting from next_d_offset if needed
            if (d_offset > next_d_offset) {
                path.nextN(next_d_offset);
                for (next_d_offset..d_offset) |bit_i| {
                    if (path.left()) {
                        path_lefts[bit_i] = path_parents[bit_i + 1];
                        right_move[bit_i] = false;
                        // move left, unfinalized
                        unfinalized_parents_buf[bit_i] = path_parents[bit_i];
                    } else {
                        path_rights[bit_i] = path_parents[bit_i + 1];
                        right_move[bit_i] = true;
                    }
                    path.next();
                }
            } else {
                path.nextN(d_offset);
            }

            // right move at d_offset, make all unfinalized parents at lower levels as finalized
            if (path.right()) {
                for (d_offset + 1..path_len) |bit_i| {
                    unfinalized_parents_buf[bit_i] = null;
                }
            }

            // Navigate down (from the depth offset) to the current index, populating parents
            for (d_offset..path_len - 1) |bit_i| {
                const idx = @intFromEnum(node_id);
                const k = states[idx].kind();
                if (noChildKind(node_id, k)) {
                    return error.InvalidNode;
                }
                const c = childrenOf(node_id, k, payloads);

                if (path.left()) {
                    path_lefts[bit_i] = path_parents[bit_i + 1];
                    path_rights[bit_i] = c.right;
                    node_id = c.left;
                    right_move[bit_i] = false;
                    unfinalized_parents_buf[bit_i] = path_parents[bit_i];
                } else {
                    path_lefts[bit_i] = c.left;
                    path_rights[bit_i] = path_parents[bit_i + 1];
                    node_id = c.right;
                    right_move[bit_i] = true;
                }
                path.next();
            }
            // final layer
            {
                const idx = @intFromEnum(node_id);
                const k = states[idx].kind();
                if (noChildKind(node_id, k)) {
                    return error.InvalidNode;
                }
                const c = childrenOf(node_id, k, payloads);
                if (path.left()) {
                    path_lefts[path_len - 1] = nodes_in[i];
                    path_rights[path_len - 1] = c.right;
                    right_move[path_len - 1] = false;
                    unfinalized_parents_buf[path_len - 1] = path_parents[path_len - 1];
                } else {
                    path_lefts[path_len - 1] = c.left;
                    path_rights[path_len - 1] = nodes_in[i];
                    right_move[path_len - 1] = true;
                }
            }

            // Rebind upwards depth diff times
            try pool.rebind(
                path_parents[next_d_offset..path_len],
                path_lefts[next_d_offset..path_len],
                path_rights[next_d_offset..path_len],
            );

            // unref prev parents if it's not part of the new tree
            // can only unref after the rebind
            for (next_d_offset..path_len) |bit_i| {
                if (right_move[bit_i] and unfinalized_parents_buf[bit_i] != null) {
                    pool.unref(unfinalized_parents_buf[bit_i].?);
                    unfinalized_parents_buf[bit_i] = null;
                }
            }
            node_id = path_parents[next_d_offset];
            d_offset = next_d_offset;
        }

        return node_id;
    }

    /// Zeroes every node strictly to the right of `index` at the provided `depth`.
    pub fn truncateAfterIndex(root_node: Id, pool: *Pool, depth: Depth, index: usize) Error!Id {
        return truncateAfterIndexWithLeafOffset(root_node, pool, depth, index, 0);
    }

    /// Like `truncateAfterIndex`, but `leaf_offset` declares how many extra
    /// levels each "leaf" at `depth` represents underneath. ChunkedLeaf-mode
    /// trees pass `leaf_offset = ChunkedLeaf.k_log2` so zeroed positions use
    /// `ZeroHash[depthi + leaf_offset]` instead of `ZeroHash[depthi]`.
    ///
    /// Pool's ZeroHash sentinels live at Node.Id `0..max_depth-1`. `depthi`
    /// tops out at `depth-1`, so the largest sentinel index used is
    /// `depth-1 + leaf_offset`; `depth + leaf_offset <= max_depth` keeps every
    /// `@enumFromInt(zero_depth)` within that range.
    pub fn truncateAfterIndexWithLeafOffset(root_node: Id, pool: *Pool, depth: Depth, index: usize, leaf_offset: Depth) Error!Id {
        std.debug.assert(@as(usize, depth) + @as(usize, leaf_offset) <= max_depth);
        if (depth == 0) {
            return root_node;
        }

        const max_length = @as(Gindex.Uint, 1) << depth;
        if (index >= max_length - 1) {
            if (index >= max_length) {
                return error.InvalidLength;
            }
            return root_node;
        }

        const path_len = @as(usize, depth);

        var path_lefts_buf: [max_depth]Id = undefined;
        var path_rights_buf: [max_depth]Id = undefined;
        var path_parents_buf: [max_depth]Id = undefined;

        const path_lefts = path_lefts_buf[0..path_len];
        const path_rights = path_rights_buf[0..path_len];
        const path_parents = path_parents_buf[0..path_len];

        try pool.alloc(path_parents);
        errdefer pool.free(path_parents);

        const states = pool.nodes.items(.state);
        const payloads = pool.nodes.items(.payload);

        var node_id = root_node;

        for (0..path_len - 1) |i| {
            const idx = @intFromEnum(node_id);
            const k = states[idx].kind();
            if (noChildKind(node_id, k)) {
                return error.InvalidNode;
            }
            const c = childrenOf(node_id, k, payloads);

            const depthi = path_len - i - 1;
            const go_left = isLeftIndex(depthi, index);
            if (go_left) {
                path_lefts[i] = path_parents[i + 1];
                const zero_depth: Depth = @intCast(depthi + @as(usize, leaf_offset));
                path_rights[i] = @enumFromInt(zero_depth);
                node_id = c.left;
            } else {
                path_lefts[i] = c.left;
                path_rights[i] = path_parents[i + 1];
                node_id = c.right;
            }
        }

        {
            const idx = @intFromEnum(node_id);
            const k = states[idx].kind();
            if (noChildKind(node_id, k)) {
                return error.InvalidNode;
            }
            const c = childrenOf(node_id, k, payloads);

            const go_left_last = isLeftIndex(0, index);
            if (go_left_last) {
                path_lefts[path_len - 1] = c.left;
                path_rights[path_len - 1] = @enumFromInt(leaf_offset);
            } else {
                path_lefts[path_len - 1] = c.left;
                path_rights[path_len - 1] = c.right;
            }
        }

        try pool.rebind(path_parents, path_lefts, path_rights);
        return path_parents[0];
    }

    inline fn isLeftIndex(depthi: usize, index: usize) bool {
        const mask: usize = @as(usize, 1) << @intCast(depthi);
        return (index & mask) == 0;
    }

    /// Set multiple nodes in batch, editing and traversing nodes strictly once.
    /// - gindexes MUST be sorted in ascending order beforehand.
    pub fn setNodes(root_node: Id, pool: *Pool, gindices: []const Gindex, nodes_in: []Id) Error!Id {
        std.debug.assert(nodes_in.len == gindices.len);
        if (gindices.len == 0) {
            return root_node;
        }

        const base_gindex = gindices[0];
        if (@intFromEnum(base_gindex) <= 1) {
            return nodes_in[0];
        }

        const path_len = base_gindex.pathLen();

        // Zero-filled so that if a later iteration errors, the errdefer's free skips the
        // not-yet-filled slots (freeing a zero id is a no-op) instead of unref-ing garbage.
        var path_parents_buf: [max_depth]Id = @splat(@as(Id, @enumFromInt(0)));
        // at each level, there is at most 1 unfinalized parent per traversal
        // "unfinalized" means it may or may not be part of the new tree.
        // Must start all-null: the cleanup loop reads slots for right-moves it never wrote this
        // pass, and an undefined `?Id` could look non-null and unref a garbage Id.
        var unfinalized_parents_buf: [max_depth]?Id = @splat(null);
        var path_lefts_buf: [max_depth]Id = undefined;
        var path_rights_buf: [max_depth]Id = undefined;
        // right_move means it's part of the new tree, it happens when we traverse right
        var right_move: [max_depth]bool = undefined;

        var node_id = root_node;
        errdefer {
            // at any points, node_id is the root of the in-progress new tree
            if (node_id != root_node) pool.unref(node_id);
            // orphaned nodes were unrefed along the way through unfinalized_parents_buf
            // path_parents_buf may or maynot be part of the in-progress new tree, there is no issue to double unref()
            pool.free(&path_parents_buf);
        }

        // The shared depth between the previous and current index
        // This is initialized as 0 since the first index has no previous index
        var d_offset: Depth = 0;

        const states = pool.nodes.items(.state);
        const payloads = pool.nodes.items(.payload);

        // For each index specified, maintain/update path_lefts and path_rights from root (depth 0) all the way to path_len
        // but only allocate and update path_parents from the next shared depth to path_len
        for (0..gindices.len) |i| {
            // Calculate the gindex bits for the current index
            const gindex = gindices[i];

            // Calculate the depth offset to navigate from current index to the next
            const next_d_offset = if (i == gindices.len - 1)
                // 0 because there is no next gindex, it also means node_id is now the new root
                0
            else
                path_len - @as(Depth, @intCast(@bitSizeOf(usize) - @clz(@intFromEnum(gindex) ^ @intFromEnum(gindices[i + 1]))));

            try pool.alloc(path_parents_buf[next_d_offset..path_len]);

            var path = gindex.toPath();

            // Navigate down (to the depth offset), attaching any new updates
            // d_offset is the shared depth between the previous and current index so we can reuse path_lefts and path_rights up that point
            // but update them to the path_parents to rebind starting from next_d_offset if needed
            if (d_offset > next_d_offset) {
                path.nextN(next_d_offset);
                for (next_d_offset..d_offset) |bit_i| {
                    if (path.left()) {
                        path_lefts_buf[bit_i] = path_parents_buf[bit_i + 1];
                        right_move[bit_i] = false;
                        // move left, unfinalized
                        unfinalized_parents_buf[bit_i] = path_parents_buf[bit_i];
                    } else {
                        path_rights_buf[bit_i] = path_parents_buf[bit_i + 1];
                        right_move[bit_i] = true;
                    }
                    path.next();
                }
            } else {
                path.nextN(d_offset);
            }

            // right move at d_offset, make all unfinalized parents at lower levels as finalized
            if (path.right()) {
                for (d_offset + 1..path_len) |bit_i| {
                    unfinalized_parents_buf[bit_i] = null;
                }
            }

            // Navigate down (from the depth offset) to the current index, populating parents
            for (d_offset..path_len - 1) |bit_i| {
                const idx = @intFromEnum(node_id);
                const k = states[idx].kind();
                if (noChildKind(node_id, k)) {
                    return error.InvalidNode;
                }
                const c = childrenOf(node_id, k, payloads);

                if (path.left()) {
                    path_lefts_buf[bit_i] = path_parents_buf[bit_i + 1];
                    path_rights_buf[bit_i] = c.right;
                    node_id = c.left;
                    right_move[bit_i] = false;
                    unfinalized_parents_buf[bit_i] = path_parents_buf[bit_i];
                } else {
                    path_lefts_buf[bit_i] = c.left;
                    path_rights_buf[bit_i] = path_parents_buf[bit_i + 1];
                    node_id = c.right;
                    right_move[bit_i] = true;
                }
                path.next();
            }
            // final layer
            {
                const idx = @intFromEnum(node_id);
                const k = states[idx].kind();
                if (noChildKind(node_id, k)) {
                    return error.InvalidNode;
                }
                const c = childrenOf(node_id, k, payloads);
                if (path.left()) {
                    path_lefts_buf[path_len - 1] = nodes_in[i];
                    path_rights_buf[path_len - 1] = c.right;
                    right_move[path_len - 1] = false;
                    unfinalized_parents_buf[path_len - 1] = path_parents_buf[path_len - 1];
                } else {
                    path_lefts_buf[path_len - 1] = c.left;
                    path_rights_buf[path_len - 1] = nodes_in[i];
                    right_move[path_len - 1] = true;
                }
            }

            // Rebind upwards depth diff times
            try pool.rebind(
                path_parents_buf[next_d_offset..path_len],
                path_lefts_buf[next_d_offset..path_len],
                path_rights_buf[next_d_offset..path_len],
            );
            // unref prev parents if it's not part of the new tree
            // can only unref after the rebind
            for (next_d_offset..path_len) |bit_i| {
                if (right_move[bit_i] and unfinalized_parents_buf[bit_i] != null) {
                    pool.unref(unfinalized_parents_buf[bit_i].?);
                    unfinalized_parents_buf[bit_i] = null;
                }
            }

            node_id = path_parents_buf[next_d_offset];
            d_offset = next_d_offset;
        }

        return node_id;
    }

    /// Set multiple nodes in batch where gindices may be at different depths.
    ///
    /// This groups updates by `gindex.pathLen()` (i.e. depth) and applies each group via `setNodes()`.
    /// - gindices MUST be sorted in ascending order beforehand.
    pub fn setNodesGrouped(root_node: Id, pool: *Pool, gindices: []const Gindex, nodes: []Id) Error!Id {
        std.debug.assert(nodes.len == gindices.len);
        if (gindices.len == 0) {
            return root_node;
        }

        var node_id = root_node;
        errdefer if (node_id != root_node) pool.unref(node_id);

        var start: usize = 0;
        while (start < gindices.len) {
            const depth = gindices[start].pathLen();
            var end: usize = start + 1;
            while (end < gindices.len and gindices[end].pathLen() == depth) : (end += 1) {}

            const prev = node_id;
            const next = try Id.setNodes(prev, pool, gindices[start..end], nodes[start..end]);
            if (prev != root_node and prev != next) {
                pool.unref(prev);
            }
            node_id = next;
            start = end;
        }

        return node_id;
    }
};

fn fillCountAtLevel(contents_count: usize, level: Depth) usize {
    var count = contents_count;
    for (0..level) |_| {
        count = count / 2 + count % 2;
    }
    return count;
}

fn restoreChildrenAndFreeParents(
    pool: *Pool,
    contents: []Id,
    previous_count: usize,
    parents_created: usize,
) void {
    var parent_index = parents_created;
    while (parent_index > 0) {
        parent_index -= 1;

        const parent = contents[parent_index];
        const parent_state = &pool.nodes.items(.state)[@intFromEnum(parent)];
        std.debug.assert(parent_state.isBranch());
        std.debug.assert(parent_state.refCount() == 0);
        const children = childrenOf(parent, .branch, pool.nodes.items(.payload));

        const child_index = parent_index * 2;
        contents[child_index] = children.left;
        if (child_index + 1 < previous_count) {
            contents[child_index + 1] = children.right;
        }

        pool.unrefUnsafe(children.left);
        pool.unrefUnsafe(children.right);
        // Child refs are restored, so return only the parent slot.
        parent_state.* = State.initFree(pool.next_free_node);
        pool.next_free_node = parent;
        pool.nodes_in_use -= 1;
    }
}

/// Fill a view with the specified contents, returning the new root node id.
///
/// Note: contents is mutated.
pub fn fillWithContents(pool: *Pool, contents: []Id, depth: Depth) !Id {
    if (contents.len == 0) {
        return @enumFromInt(depth);
    }
    const max_length = @as(Gindex.Uint, 1) << depth;
    if (contents.len > max_length) {
        return error.InvalidLength;
    }

    var d = depth;
    var count = contents.len;
    var i: usize = 0;
    errdefer {
        // The failing level may contain only a prefix of its parents. Restore those children
        // first, then unwind each completed level until contents holds the original node IDs.
        restoreChildrenAndFreeParents(pool, contents, count, i / 2);

        var level = depth - d;
        while (level > 0) {
            const previous_count = fillCountAtLevel(contents.len, level - 1);
            const parent_count = fillCountAtLevel(contents.len, level);
            restoreChildrenAndFreeParents(pool, contents, previous_count, parent_count);
            level -= 1;
        }
    }

    while (d > 0) : (d -= 1) {
        i = 0;
        while (i < count - 1) : (i += 2) {
            contents[i / 2] = try pool.createBranch(contents[i], contents[i + 1]);
        }

        // if the count is odd, we need to add a zero node
        if (i != count) {
            contents[i / 2] = try pool.createBranch(contents[i], @enumFromInt(depth - d));
        }

        count = (count + 1) / 2;
    }

    return contents[0];
}

/// Iterator to traverse all nodes at a specific depth.
/// Use this instead of `getNodesAtDepth` when memory usage is a concern.
pub const DepthIterator = struct {
    pool: *Pool,
    node_id: Id,
    parents_buf: [max_depth]Id,
    diffi: Depth,
    base_gindex: Gindex,
    index: usize,

    /// Initialize a depth iterator starting from `start_index` at the specified `depth`.
    ///
    /// There is no `deinit` function since the iterator does not allocate any resources.
    pub fn init(pool: *Pool, root_node: Id, depth: Depth, start_index: usize) DepthIterator {
        return .{
            .pool = pool,
            .node_id = root_node,
            .parents_buf = undefined,
            .diffi = depth,
            .base_gindex = Gindex.fromDepth(depth, 0),
            .index = start_index,
        };
    }

    pub fn next(self: *DepthIterator) Error!Id {
        const path_len = self.base_gindex.pathLen();
        // Depth 0: only the root exists; yield once then finish.
        if (@intFromEnum(self.base_gindex) <= 1) {
            if (self.index != 0) return error.InvalidLength;
            self.index = 1;
            return self.node_id;
        }

        const max_length: Gindex.Uint = @intFromEnum(self.base_gindex);
        if (self.index >= max_length) return error.InvalidLength;

        const states = self.pool.nodes.items(.state);
        const payloads = self.pool.nodes.items(.payload);

        // Compute gindex for current index at the requested depth.
        const gindex = Gindex.fromUint(@intCast(@intFromEnum(self.base_gindex) | self.index));

        // diffi: how many levels we can reuse from previous traversal (initialized to depth by caller state)
        const d = path_len - self.diffi;

        var path = gindex.toPath();
        path.nextN(d);

        var node_id = self.node_id;

        // Navigate down from the shared prefix (d) to the target, updating parents.
        for (d..path_len) |bit_i| {
            const idx = @intFromEnum(node_id);
            const k = states[idx].kind();
            if (noChildKind(node_id, k)) {
                return error.InvalidNode;
            }
            const c = childrenOf(node_id, k, payloads);
            self.parents_buf[bit_i] = node_id;
            node_id = if (path.left()) c.left else c.right;
            path.next();
        }

        // Yield current node.
        const out_id = node_id;

        // Prepare state for next index.
        const index = self.index;
        self.index += 1;

        if (self.index >= max_length) {
            // No next element; iterator is done after this yield.
            return out_id;
        }

        // Same "depth diff" computation as getNodesAtDepth (underflow-safe: only used when there is a next index).
        self.diffi = @intCast(@bitSizeOf(Gindex) - @clz(index ^ (index + 1)));
        self.node_id = self.parents_buf[path_len - self.diffi];

        return out_id;
    }
};

/// Incrementally build a tree by appending leaves, filling missing right siblings with zero-nodes.
/// Matches the behavior of `fillWithContents`, but optimized for incremental appends.
pub const SubtreeBuilder = struct {
    pool: *Pool,
    depth: Depth,
    /// Absolute depth, in chunks, of each appended Id. For depth-0 leaves
    /// (chunks) this is 0. For chunked_leaf Ids it is `ChunkedLeaf.k_log2`. Zero fillers
    /// emitted by `finish()` for missing right siblings at builder level L
    /// must therefore be at absolute depth `L + leaf_offset`.
    leaf_offset: Depth,
    // At each level i, holds either null or the unpaired left node at that level.
    lefts: [max_depth]?Id,

    /// Initialize a builder where each appended Id is a depth-0 leaf
    /// (a chunk). Equivalent to `initWithOffset(pool, depth, 0)`.
    pub fn init(pool: *Pool, depth: Depth) SubtreeBuilder {
        return initWithOffset(pool, depth, 0);
    }

    /// Initialize a builder where each appended Id is a depth-`leaf_offset`
    /// subtree (e.g. a chunked_leaf Id is a depth-`ChunkedLeaf.k_log2` subtree of K chunks).
    /// Zero fillers in `finish()` use `@enumFromInt(level + leaf_offset)`
    /// so the resulting tree's root is correct under standard SSZ
    /// merkleization at absolute depth `depth + leaf_offset`.
    pub fn initWithOffset(pool: *Pool, depth: Depth, leaf_offset: Depth) SubtreeBuilder {
        return .{
            .pool = pool,
            .depth = depth,
            .leaf_offset = leaf_offset,
            .lefts = [_]?Id{null} ** max_depth,
        };
    }

    /// Clean up references held by the builder.
    ///
    /// This only needs to be called if the builder is abandoned before `finish` is called.
    pub fn deinit(self: *SubtreeBuilder) void {
        for (self.lefts) |left| {
            if (left) |node_id| {
                self.pool.unref(node_id);
            }
        }
    }

    /// Append a leaf (or subtree root at leaf level). Builds branches incrementally.
    pub fn append(self: *SubtreeBuilder, node_id: Id) Error!void {
        // Bounds check
        if (self.lefts[self.depth] != null) {
            return error.InvalidLength;
        }

        var carry = node_id;
        for (0..self.depth) |level| {
            if (self.lefts[level]) |left| {
                // Build the branch before clearing `left`, so a failed createBranch leaves `left`
                // reclaimable by deinit. Release the orphaned `carry` too — unless it's the same
                // node as `left` (the all-default path pairs a node with itself).
                const branch = self.pool.createBranch(left, carry) catch |err| {
                    if (carry != left) self.pool.unref(carry);
                    return err;
                };
                self.lefts[level] = null;
                carry = branch;
            } else {
                self.lefts[level] = carry;
                return;
            }
        }
        // Only reaches here if the tree is full
        self.lefts[self.depth] = carry;
    }

    /// Finalize the tree, returning the root node. Uses zero-nodes to pad missing right siblings.
    pub fn finish(self: *SubtreeBuilder) Error!Id {
        if (self.lefts[self.depth]) |root| {
            return root;
        }

        // Initial carry = zero subtree at absolute depth `depth + leaf_offset`.
        var carry: Id = @enumFromInt(@as(u32, self.depth) + @as(u32, self.leaf_offset));
        var start_level: usize = self.depth;

        // Find the lowest non-null as starting carry. Its absolute depth is
        // `level + leaf_offset` because each appended Id sits at depth `leaf_offset`.
        for (0..self.depth) |level| {
            if (self.lefts[level] != null) {
                carry = @enumFromInt(@as(u32, @intCast(level)) + @as(u32, self.leaf_offset));
                start_level = level;
                break;
            }
        }

        // Starting from the lowest non-null, build upwards with zero-nodes.
        // A missing right sibling at builder level `level` is a zero subtree
        // at absolute depth `level + leaf_offset`.
        for (start_level..self.depth) |level| {
            if (self.lefts[level]) |left| {
                // Same as above: keep `left` reclaimable and release `carry` on failure. Here
                // `carry` is never the same node as `left`.
                const branch = self.pool.createBranch(left, carry) catch |err| {
                    self.pool.unref(carry);
                    return err;
                };
                self.lefts[level] = null;
                carry = branch;
            } else {
                // Release `carry` on failure; the missing right sibling is a zero-node sentinel.
                carry = self.pool.createBranch(carry, @enumFromInt(@as(u32, @intCast(level)) + @as(u32, self.leaf_offset))) catch |err| {
                    self.pool.unref(carry);
                    return err;
                };
            }
        }
        return carry;
    }
};

test {
    _ = @import("node_test.zig");
}
