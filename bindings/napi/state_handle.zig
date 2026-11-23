const StateRc = @import("state_transition").CachedBeaconStateRc;
const BeaconStateView = @import("BeaconStateView.zig");

/// Borrows the view's reference without changing its count. Do not unref the result.
/// Keep view alive and unreleased until the last use; do not carry this borrow across JS callbacks.
pub fn borrowState(view: *const BeaconStateView) !*StateRc {
    if (view.release_requested) return error.InvalidState;
    return view.state_rc orelse return error.InvalidState;
}
