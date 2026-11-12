const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;

pub fn processParticipationFlagUpdates(
    comptime fork: ForkSeq,
    state: *BeaconState(fork),
) !void {
    if (comptime fork.lt(.altair)) return;
    try state.rotateEpochParticipation();
}
