const std = @import("std");
const Runtime = @import("network_runtime.zig").Runtime;
const exchange_mod = @import("network_exchange.zig");
const exchange_js = @import("network_exchange_js.zig");
const shim = @import("network_test_support.zig");

test "exchange failures classify as stopped or contract" {
    // An exception that clears is the bridge's contract failure; a pending-exception status with none pending is how
    // N-API reports JavaScript that cannot run.
    var classified: Runtime = .{ .env = undefined, .bridge = .{ .notify_live = false } };
    var host: exchange_js.Host = .{ .env = undefined, .runtime = &classified };
    for ([_]struct { anyerror, bool, exchange_mod.Failure }{
        .{ error.Closing, true, .stopped },
        .{ error.CannotRunJS, true, .stopped },
        .{ error.PendingException, false, .stopped },
        .{ error.PendingException, true, .contract },
        .{ error.GenericFailure, false, .contract },
        .{ error.GenericFailure, true, .contract },
    }) |case| {
        shim.exception_pending = case[1];
        try std.testing.expectEqual(case[2], host.classify(case[0]));
        try std.testing.expectEqual(case[1] and case[2] == .stopped, shim.exception_pending);
    }
}
