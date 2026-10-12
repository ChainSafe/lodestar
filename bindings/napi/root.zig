//! Load only one addon version per process; class instances cannot cross versions.

const std = @import("std");
const builtin = @import("builtin");
const js = @import("zapi:zapi").js;
const pool = @import("./pool.zig");
pub const shuffle = @import("./shuffle.zig");
pub const metrics = @import("./metrics.zig");
pub const stateTransition = @import("./stateTransition.zig");
pub const BeaconConfig = @import("./BeaconConfig.zig");
pub const BeaconStateView = @import("./BeaconStateView.zig");
pub const blst = @import("./blst.zig");
pub const blsVerifier = @import("./bls_verifier.zig");
pub const pubkeys = @import("./pubkeys.zig");
pub const executionProofVerifier = @import("./execution_proof_verifier.zig");

const options = @import("bls_options");

var gpa: std.heap.DebugAllocator(.{}) = .init;
const allocator = if (builtin.mode == .Debug) gpa.allocator() else std.heap.c_allocator;

fn init(old_ref_count: u32) !void {
    if (old_ref_count == 0) {
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
    _ = @import("tracked_allocator.zig");
}
