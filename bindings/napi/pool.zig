const std = @import("std");
const napi = @import("zapi:zapi").napi;
const js = @import("zapi:zapi").js;
const Node = @import("persistent_merkle_tree").Node;
const RefCount = @import("state_transition").RefCount;
const TrackedAllocator = @import("tracked_allocator.zig");

/// Backs the `PoolRc` wrapper allocation only — `Node.Pool` uses its own
/// `InitOptions` allocators.
const allocator = std.heap.page_allocator;

const pool_size_environment_variable = "LODESTAR_Z_NODE_POOL_CAPACITY";
// Arbitrary limit to avoid excessive memory usage.
const default_pool_size: u32 = 10_000_000;

const PoolRc = RefCount(Owner);

const Owner = struct {
    pool: Node.Pool = undefined,
    memory: TrackedAllocator = .{ .backing = std.heap.c_allocator },
    env: ?napi.Env,
    reported_bytes: i64 = 0,

    pub fn reportMemory(self: *Owner) void {
        const env = self.env orelse return;
        const node_bytes = @sizeOf(@FieldType(Node, "payload")) +
            @sizeOf(@FieldType(Node, "root")) + @sizeOf(@FieldType(Node, "state"));
        const bytes: i64 = @intCast(self.pool.getNodesInUse() * node_bytes + self.memory.bytesInUse());
        const delta = bytes - self.reported_bytes;
        if (delta == 0) return;

        // Notification can collect other views sharing this owner. Publish the ledger first.
        self.reported_bytes = bytes;
        _ = env.adjustExternalMemory(delta) catch {
            self.reported_bytes -= delta;
            return;
        };
    }

    pub fn deinit(self: *Owner) void {
        std.debug.assert(self.env == null);
        self.pool.deinit();
        std.debug.assert(self.memory.bytesInUse() == 0);
    }
};

fn poolSizeFromEnvironment() !u32 {
    const raw = std.c.getenv(pool_size_environment_variable) orelse return default_pool_size;
    const value = std.mem.span(raw);
    return std.fmt.parseInt(u32, value, 10) catch error.InvalidPoolCapacity;
}

/// Pool is wrapped in `RefCount` so binding objects holding pool refs at
/// process exit keep the pool alive until their JS finalizer runs. NAPI
/// env cleanup hook fires before module-level JS holders are finalized,
/// so an unconditional `pool.deinit()` there would free memory that
/// `pool.unref()` calls in those finalizers still need.
const State = struct {
    pool_rc: ?*PoolRc = null,

    fn init(self: *State) !void {
        if (self.pool_rc != null) return;

        const pool_size = try poolSizeFromEnvironment();

        const rc = try PoolRc.create(allocator, .{ .env = js.env() });
        errdefer allocator.destroy(rc);
        rc.instance.pool = try Node.Pool.init(.{
            .allocator = rc.instance.memory.allocator(),
            .pool_size = pool_size,
        });
        self.pool_rc = rc;
    }

    pub fn deinit(self: *State) void {
        if (self.pool_rc) |rc| {
            // Late view finalizers must release memory without using the closing environment.
            rc.instance.env = null;
            rc.unref();
            self.pool_rc = null;
        }
    }

    pub fn poolRc(self: *State) !*PoolRc {
        try self.init();
        return self.pool_rc.?;
    }
};

pub threadlocal var state: State = .{};
