const std = @import("std");
const Budget = @import("network_budget.zig").Budget;

test "remote responses leave capacity for local requests and urgent publication" {
    var budget: Budget = .{ .limit = 1000 };
    try budget.protect(100, 200, 100);
    try budget.reserve(.incoming, 700);
    try std.testing.expectError(error.NetworkBridgeFull, budget.reserve(.incoming, 1));
    try budget.reserve(.outgoing, 200);
    try budget.reserve(.urgent_publication, 100);
    try std.testing.expectEqual(@as(usize, 1000), budget.used);
    budget.release(.incoming, 400);
    try budget.reserve(.publication, 400);
    budget.release(.incoming, 300);
    budget.release(.outgoing, 200);
    budget.release(.urgent_publication, 100);
    budget.release(.publication, 400);
    try std.testing.expectEqual(@as(usize, 0), budget.used);
}

test "local work leaves response progress capacity and startup rejects insufficient backing" {
    var budget: Budget = .{ .limit = 1000 };
    try std.testing.expectError(error.NetworkBridgeBudgetExceeded, budget.protect(100, 500, 401));
    try budget.protect(100, 200, 100);
    try budget.reserve(.outgoing, 800);
    try std.testing.expectError(error.NetworkBridgeFull, budget.reserve(.publication, 1));
    try budget.reserve(.incoming, 100);
    try budget.reserve(.urgent_publication, 100);
    budget.release(.outgoing, 800);
    budget.release(.incoming, 100);
    budget.release(.urgent_publication, 100);
    try std.testing.expectEqual(@as(usize, 0), budget.used);
}
