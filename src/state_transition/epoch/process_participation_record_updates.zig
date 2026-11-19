const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;

pub fn processParticipationRecordUpdates(
    comptime fork: ForkSeq,
    state: *BeaconState(fork),
) !void {
    if (comptime fork != .phase0) return;
    // rotate current/previous epoch attestations
    try state.rotateEpochPendingAttestations();
}
