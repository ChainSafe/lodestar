//! Load only one addon version per process; class instances cannot cross versions.

const std = @import("std");
const builtin = @import("builtin");
const js = @import("zapi:zapi").js;
const pool = @import("./pool.zig");
const network_logging = @import("network").logging;
pub const shuffle = @import("./shuffle.zig");
pub const metrics = @import("./metrics.zig");
pub const stateTransition = @import("./stateTransition.zig");
pub const BeaconConfig = @import("./BeaconConfig.zig");
pub const BeaconStateView = @import("./BeaconStateView.zig");
pub const blst = @import("./blst.zig");
pub const blsVerifier = @import("./bls_verifier.zig");
pub const NativeNetworkRuntime = @import("./network.zig");
pub const pubkeys = @import("./pubkeys.zig");
pub const executionProofVerifier = @import("./execution_proof_verifier.zig");

const options = @import("bls_options");
pub const std_options: std.Options = .{
    .log_scope_levels = network_logging.scope_levels,
    .logFn = network_logging.logFn,
};

var gpa: std.heap.DebugAllocator(.{}) = .init;
const allocator = if (builtin.mode == .Debug) gpa.allocator() else std.heap.c_allocator;

fn init(old_ref_count: u32) !void {
    if (old_ref_count == 0) {
        if (!pinned) try pinImage();
        // First environment — initialize shared state in your threadpool init.
        var cpu_count: u64 = options.thread_count;
        if (options.thread_count == 0) {
            cpu_count = @max(try detectCpuCount(), 2) - 1;
            std.log.debug(
                "Note: no -Dthread-count set, using cgroup-aware CPU count minus 1: {}\n",
                .{cpu_count},
            );
        }

        const n_workers = @min(cpu_count, @import("bls").ThreadPool.MAX_WORKERS);
        try blst.state.init(@intCast(n_workers));
        errdefer blst.state.deinit();

        try pubkeys.state.init(js.env());

        // All remaining initialization must stay infallible because the earlier errdefers no
        // longer cover every initialized global.
        errdefer comptime unreachable;
    }
}

const DlInfo = extern struct {
    fname: ?[*:0]const u8,
    fbase: ?*anyopaque,
    sname: ?[*:0]const u8,
    saddr: ?*anyopaque,
};
extern "c" fn dladdr(address: *const anyopaque, info: *DlInfo) c_int;

/// Whether the process holds its one pin on this image. Only `init` reads or sets it, under the
/// lifecycle mutex. The pin is never released, so it survives environment cleanup and a later
/// failed initialization, and the pinned image keeps this value.
var pinned = false;

/// Keeps this image loaded for the process lifetime. The network's BoringSSL frees a thread's
/// state from a pthread key destructor in this image, also on the JS thread that initialized a
/// runtime. Node unloads an addon when its last environment ends, which for a worker comes
/// before its thread exits and runs that destructor.
fn pinImage() !void {
    var info: DlInfo = undefined;
    if (dladdr(@ptrCast(&pinImage), &info) == 0) return error.AddonImageUnknown;
    const path = info.fname orelse return error.AddonImageUnknown;
    _ = std.c.dlopen(path, .{ .NOW = true, .NOLOAD = true, .NODELETE = true }) orelse return error.AddonImageUnknown;
    pinned = true;
}

/// cgroup-aware CPU count for sizing the BLS pool. A detection failure must
/// not prevent the module from loading: warn and fall back to the affinity
/// count (what `std.Thread.getCpuCount()` reports).
fn detectCpuCount() !usize {
    return @import("cpu_count").getNumCpus(allocator, js.io()) catch |err| {
        std.log.debug(
            "Warning: cgroup CPU detection failed ({s}), using affinity count\n",
            .{@errorName(err)},
        );
        return std.Thread.getCpuCount();
    };
}

fn cleanup(new_ref_count: u32) void {
    stateTransition.deinitReusedEpochTransitionCache();
    metrics.deinit();
    pool.state.deinit();

    if (new_ref_count == 0) {
        // Last environment — tear down shared state.
        blst.state.deinit();
        pubkeys.state.deinit();
        executionProofVerifier.state.deinit();
    }
}

comptime {
    js.exportModule(@This(), .{
        .identity = @import("zapi_addon_identity"),
        .init = init,
        .cleanup = cleanup,
    });
}

test {
    _ = @import("network_runtime.zig");
    _ = @import("tracked_allocator.zig");
}
