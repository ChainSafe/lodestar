const std = @import("std");
const Allocator = std.mem.Allocator;
const CachedBeaconState = @import("state_cache.zig").CachedBeaconState;

/// Shared ownership of one state allocation. Its config, node pool, pubkey cache,
/// and allocator backing must outlive every reference, including final cleanup.
/// Reference counting does not synchronize access to the state or its resources.
pub const CachedBeaconStateRc = struct {
    allocator: Allocator,
    ref_count: std.atomic.Value(u32),
    instance: *CachedBeaconState,

    // TODO: Reuse RefCount when it supports complete pointee destruction.
    // RefCount(*CachedBeaconState) calls deinit() but leaves the state allocation
    // alive. Always destroying pointer payloads would double-free self-destroying types.

    /// Adopts an exclusively owned state on success. On failure the caller still
    /// owns it. Never wrap an already shared state in another Rc control block.
    pub fn create(allocator: Allocator, state: *CachedBeaconState) !*CachedBeaconStateRc {
        const self = try allocator.create(CachedBeaconStateRc);
        self.* = .{
            .allocator = allocator,
            .ref_count = std.atomic.Value(u32).init(1),
            .instance = state,
        };
        return self;
    }

    /// Borrows the state while a reference remains held. Do not deinit the result.
    pub fn get(self: *CachedBeaconStateRc) *CachedBeaconState {
        return self.instance;
    }

    /// Acquires another reference from a live owner. Caller must unref() it.
    pub fn ref(self: *CachedBeaconStateRc) *CachedBeaconStateRc {
        const previous = self.ref_count.fetchAdd(1, .monotonic);
        std.debug.assert(previous > 0 and previous < std.math.maxInt(u32));
        return self;
    }

    pub fn unref(self: *CachedBeaconStateRc) void {
        const previous = self.ref_count.fetchSub(1, .release);
        std.debug.assert(previous > 0);
        if (previous == 1) {
            _ = self.ref_count.load(.acquire);
            const state_allocator = self.instance.allocator;
            self.instance.deinit();
            state_allocator.destroy(self.instance);
            self.allocator.destroy(self);
        }
    }
};

test {
    _ = @import("cached_beacon_state_rc_test.zig");
}
