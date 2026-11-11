pub const RunnerKind = enum {
    epoch_processing,
    fork,
    finality,
    merkle_proof,
    operations,
    random,
    rewards,
    sanity,
    transition,
    shuffling,

    pub fn hasSuiteCase(comptime self: RunnerKind) bool {
        return switch (self) {
            .merkle_proof => true,
            else => false,
        };
    }
};
