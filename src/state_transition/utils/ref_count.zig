const std = @import("std");
const Allocator = std.mem.Allocator;

/// A reference counted wrapper for a type `T`.
/// T should be `*Something`, not `*const Something` due to deinit()
pub fn RefCount(comptime T: type) type {
    return struct {
        allocator: Allocator,
        _ref_count: std.atomic.Value(u32),
        instance: T,

        /// Takes ownership of `instance` on success; the caller retains ownership on failure.
        pub fn create(allocator: Allocator, instance: T) !*@This() {
            const ptr = try allocator.create(@This());
            ptr.init(allocator, instance);
            return ptr;
        }

        /// Takes ownership of `instance` and uninitialized `self` allocated by `allocator.create`.
        pub fn init(self: *@This(), allocator: Allocator, instance: T) void {
            self.* = .{
                .allocator = allocator,
                ._ref_count = std.atomic.Value(u32).init(1),
                .instance = instance,
            };
        }

        /// Private deinit invoked internally only by
        /// the last remaining reference counted instance of T.
        ///
        /// Consumer should call unref() instead.
        ///
        /// Dispatches to either `T.deinit(self)` or `T.deinit(self, allocator)`
        /// depending on the wrapped type's signature. This is needed because
        /// 0.16 unmanaged ArrayList uses the 2-arg form while many project
        /// types still expose the 1-arg form.
        fn deinit(self: *@This()) void {
            const BaseT = switch (@typeInfo(T)) {
                .pointer => |p| p.child,
                else => T,
            };
            const deinit_params = @typeInfo(@TypeOf(BaseT.deinit)).@"fn".params;
            if (comptime deinit_params.len > 1) {
                self.instance.deinit(self.allocator);
            } else {
                self.instance.deinit();
            }
            self.allocator.destroy(self);
        }

        pub fn get(self: *@This()) T {
            return self.instance;
        }

        /// Mutable access to the instance when the caller holds the only reference, else null.
        ///
        /// The caller must ensure exclusive access to `self` and its instance
        /// for the lifetime of the returned pointer.
        pub fn getMutIfUnique(self: *@This()) ?*T {
            if (self._ref_count.load(.acquire) != 1) return null;
            return &self.instance;
        }

        pub fn ref(self: *@This()) *@This() {
            _ = self._ref_count.fetchAdd(1, .monotonic);
            return self;
        }

        pub fn unref(self: *@This()) void {
            if (self._ref_count.fetchSub(1, .release) == 1) {
                _ = self._ref_count.load(.acquire);
                self.deinit();
            }
        }
    };
}

test {
    _ = @import("ref_count_test.zig");
}
