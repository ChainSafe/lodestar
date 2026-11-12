const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const ssz = @import("consensus_types");
const Root = ssz.primitive.Root.Type;
const ForkSeq = @import("config").ForkSeq;
const preset = @import("preset").preset;
const active_preset = @import("preset").active_preset;
const state_transition = @import("state_transition");
const TestCachedBeaconState = state_transition.test_utils.TestCachedBeaconState;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const BeaconBlock = @import("fork_types").BeaconBlock;
const BeaconBlockBody = @import("fork_types").BeaconBlockBody;
const Withdrawals = ssz.capella.Withdrawals.Type;
const WithdrawalsResult = state_transition.WithdrawalsResult;
const test_case = @import("../test_case.zig");
const TestCaseUtils = test_case.TestCaseUtils;
const loadSszValue = test_case.loadSszSnappyValue;
const loadBlsSetting = test_case.loadBlsSetting;
const expectEqualBeaconStates = test_case.expectEqualBeaconStates;
const BlsSetting = test_case.BlsSetting;

/// See https://github.com/ethereum/consensus-specs/tree/master/tests/formats/operations#operations-tests
pub const Operation = enum {
    attestation,
    attester_slashing,
    block_header,
    bls_to_execution_change,
    builder_deposit_request,
    builder_exit_request,
    consolidation_request,
    deposit,
    deposit_request,
    execution_payload,
    execution_payload_bid,
    parent_execution_payload,
    payload_attestation,
    proposer_slashing,
    sync_aggregate,
    sync_aggregate_random,
    voluntary_exit,
    voluntary_exit_churn,
    withdrawal_request,
    withdrawals,

    pub fn inputName(self: Operation) []const u8 {
        return switch (self) {
            .block_header, .parent_execution_payload => "block",
            .bls_to_execution_change => "address_change",
            .execution_payload => "body",
            .withdrawals => "execution_payload",
            .sync_aggregate_random => "sync_aggregate",
            .voluntary_exit_churn => "voluntary_exit",
            else => @tagName(self),
        };
    }

    pub fn operationObject(self: Operation) []const u8 {
        return switch (self) {
            .attestation => "Attestation",
            .attester_slashing => "AttesterSlashing",
            .block_header => "BeaconBlock",
            .bls_to_execution_change => "SignedBLSToExecutionChange",
            .builder_deposit_request => "BuilderDepositRequest",
            .builder_exit_request => "BuilderExitRequest",
            .consolidation_request => "ConsolidationRequest",
            .deposit => "Deposit",
            .deposit_request => "DepositRequest",
            .execution_payload => "BeaconBlockBody",
            .execution_payload_bid => "SignedExecutionPayloadBid",
            .parent_execution_payload => "BeaconBlock",
            .payload_attestation => "PayloadAttestation",
            .proposer_slashing => "ProposerSlashing",
            .sync_aggregate, .sync_aggregate_random => "SyncAggregate",
            .voluntary_exit, .voluntary_exit_churn => "SignedVoluntaryExit",
            .withdrawal_request => "WithdrawalRequest",
            .withdrawals => "ExecutionPayload",
        };
    }

    pub fn suiteName(self: Operation) []const u8 {
        return @tagName(self) ++ "/pyspec_tests";
    }
};

pub const Handler = Operation;

pub fn TestCase(comptime fork: ForkSeq, comptime operation: Operation) type {
    const ForkTypes = @field(ssz, fork.name());
    const tc_utils = TestCaseUtils(fork);
    const no_input = fork.gte(.gloas) and operation == .withdrawals;
    const OpType = if (no_input) ssz.primitive.Root else @field(ForkTypes, operation.operationObject());

    return struct {
        pre: TestCachedBeaconState,
        // a null post state means the test is expected to fail
        post: ?*AnyBeaconState,
        op: OpType.Type,
        bls_setting: BlsSetting,
        execution_payload_status: state_transition.ExecutionPayloadStatus = .valid,

        const Self = @This();

        pub fn execute(allocator: std.mem.Allocator, dir: std.Io.Dir) !void {
            const pool_size = if (active_preset == .mainnet) 10_000_000 else 1_000_000;
            const pool = try test_case.acquirePool(allocator, pool_size);
            defer test_case.releasePool();

            var tc = try Self.init(allocator, pool, dir);
            defer {
                tc.deinit();
                state_transition.deinitReusedEpochTransitionCache();
            }

            try tc.runTest();
        }

        pub fn init(allocator: std.mem.Allocator, pool: *Node.Pool, dir: std.Io.Dir) !Self {
            var tc = Self{
                .pre = undefined,
                .post = undefined,
                .op = OpType.default_value,
                .bls_setting = try loadBlsSetting(allocator, dir),
            };

            // load pre state
            tc.pre = try tc_utils.loadPreState(allocator, pool, dir);
            errdefer tc.pre.deinit();

            // load pre state
            tc.post = try tc_utils.loadPostState(allocator, pool, dir);
            errdefer if (tc.post) |post| {
                post.deinit();
                allocator.destroy(post);
            };

            // load the op
            if (!no_input) try loadSszValue(OpType, allocator, dir, comptime operation.inputName() ++ ".ssz_snappy", &tc.op);
            errdefer if (comptime @hasDecl(OpType, "deinit")) OpType.deinit(allocator, &tc.op);
            if (operation == .execution_payload) tc.execution_payload_status = try test_case.loadExecutionPayloadStatus(allocator, dir);

            return tc;
        }

        pub fn deinit(self: *Self) void {
            if (comptime @hasDecl(OpType, "deinit")) {
                OpType.deinit(self.pre.allocator, &self.op);
            }
            self.pre.deinit();
            if (self.post) |post| {
                post.deinit();
                self.pre.allocator.destroy(post);
            }
        }

        pub fn process(self: *Self) !void {
            const verify = self.bls_setting.verify();
            const allocator = self.pre.allocator;
            const io = std.testing.io;
            const cached_state = self.pre.cached_state;
            const state = cached_state.state.castToFork(fork);

            switch (operation) {
                .attestation => {
                    const config = cached_state.config;
                    const epoch_cache = cached_state.epoch_cache;
                    var attestations = [_]ForkTypes.Attestation.Type{self.op};
                    try state_transition.processAttestations(
                        fork,
                        allocator,
                        io,
                        config,
                        epoch_cache,
                        state,
                        &cached_state.proposer_rewards,
                        &cached_state.slashings_cache,
                        attestations[0..],
                        if (fork.gte(.gloas)) try state.latestBlockHeaderSlot() else null,
                        verify,
                    );
                },
                .attester_slashing => {
                    const config = cached_state.config;
                    const epoch_cache = cached_state.epoch_cache;
                    const current_epoch = epoch_cache.epoch;
                    try state_transition.processAttesterSlashing(
                        fork,
                        allocator,
                        io,
                        config,
                        epoch_cache,
                        state,
                        &cached_state.proposer_rewards,
                        &cached_state.slashings_cache,
                        current_epoch,
                        &self.op,
                        verify,
                    );
                },
                .block_header => {
                    const epoch_cache = cached_state.epoch_cache;
                    const fork_block = BeaconBlock(.full, fork){ .inner = self.op };
                    try state_transition.processBlockHeader(
                        fork,
                        allocator,
                        epoch_cache,
                        state,
                        .full,
                        &fork_block,
                    );
                },
                .bls_to_execution_change => {
                    const config = cached_state.config;
                    try state_transition.processBlsToExecutionChange(fork, config, state, &self.op);
                },
                .builder_deposit_request => try state_transition.processBuilderDepositRequest(fork, allocator, cached_state.config, state, &self.op),
                .builder_exit_request => try state_transition.processBuilderExitRequest(fork, allocator, cached_state.config, state, &self.op),
                .consolidation_request => {
                    const config = cached_state.config;
                    const epoch_cache = cached_state.epoch_cache;
                    try state_transition.processConsolidationRequest(fork, io, config, epoch_cache, state, &self.op);
                },
                .deposit => {
                    const config = cached_state.config;
                    const epoch_cache = cached_state.epoch_cache;
                    try state_transition.processDeposit(fork, io, config, epoch_cache, state, &self.op);
                },
                .deposit_request => {
                    try state_transition.processDepositRequest(fork, state, &self.op);
                },
                .execution_payload => {
                    const config = cached_state.config;
                    const epoch_cache = cached_state.epoch_cache;
                    const current_epoch = epoch_cache.epoch;
                    const fork_body = BeaconBlockBody(.full, fork){ .inner = self.op };
                    try state_transition.processExecutionPayload(
                        fork,
                        allocator,
                        config,
                        state,
                        current_epoch,
                        .full,
                        &fork_body,
                        .{
                            .data_availability_status = .available,
                            .execution_payload_status = self.execution_payload_status,
                        },
                    );
                },
                .execution_payload_bid => try state_transition.processExecutionPayloadBid(fork, allocator, cached_state.config, cached_state.epoch_cache, state, &self.op),
                .parent_execution_payload => {
                    const block = BeaconBlock(.full, fork){ .inner = self.op };
                    try state_transition.processParentExecutionPayload(fork, allocator, io, cached_state.config, cached_state.epoch_cache, state, &block);
                },
                // Standalone payload-attestation vectors include invalid signatures
                // without bls_setting metadata, matching Lodestar's operation runner.
                .payload_attestation => try state_transition.processPayloadAttestation(fork, io, cached_state.config, cached_state.epoch_cache, state, &self.op, true),
                .proposer_slashing => {
                    const config = cached_state.config;
                    const epoch_cache = cached_state.epoch_cache;
                    try state_transition.processProposerSlashing(
                        fork,
                        allocator,
                        io,
                        config,
                        epoch_cache,
                        state,
                        &cached_state.proposer_rewards,
                        &cached_state.slashings_cache,
                        &self.op,
                        verify,
                    );
                },
                .sync_aggregate, .sync_aggregate_random => {
                    const config = cached_state.config;
                    const epoch_cache = cached_state.epoch_cache;
                    try state_transition.processSyncAggregate(
                        fork,
                        io,
                        config,
                        epoch_cache,
                        state,
                        &cached_state.proposer_rewards,
                        &self.op,
                        verify,
                    );
                },
                .voluntary_exit, .voluntary_exit_churn => {
                    const config = cached_state.config;
                    const epoch_cache = cached_state.epoch_cache;
                    try state_transition.processVoluntaryExit(
                        fork,
                        io,
                        config,
                        epoch_cache,
                        state,
                        &self.op,
                        verify,
                    );
                },
                .withdrawal_request => {
                    const config = cached_state.config;
                    const epoch_cache = cached_state.epoch_cache;
                    try state_transition.processWithdrawalRequest(fork, io, config, epoch_cache, state, &self.op);
                },
                .withdrawals => {
                    const epoch_cache = cached_state.epoch_cache;

                    var withdrawals_buf: [preset.MAX_WITHDRAWALS_PER_PAYLOAD]ssz.capella.Withdrawal.Type = undefined;
                    var withdrawals_result = WithdrawalsResult{
                        .withdrawals = Withdrawals.initBuffer(&withdrawals_buf),
                    };

                    var withdrawal_balances = std.AutoHashMap(u64, usize).init(allocator);
                    defer withdrawal_balances.deinit();

                    try state_transition.getExpectedWithdrawals(
                        fork,
                        epoch_cache,
                        state,
                        &withdrawals_result,
                        &withdrawal_balances,
                    );

                    var payload_withdrawals_root: Root = @splat(0);
                    if (comptime fork.lt(.gloas)) {
                        try ssz.capella.Withdrawals.hashTreeRoot(allocator, &self.op.withdrawals, &payload_withdrawals_root);
                    }

                    try state_transition.processWithdrawals(
                        fork,
                        allocator,
                        state,
                        withdrawals_result,
                        payload_withdrawals_root,
                        null,
                    );
                },
            }
        }

        pub fn runTest(self: *Self) !void {
            if (self.post) |post| {
                try self.process();
                try expectEqualBeaconStates(post, self.pre.cached_state.state);
            } else {
                self.process() catch |err| {
                    return test_case.expectConsensusInvalid(err);
                };
                return error.ExpectedError;
            }
        }
    };
}
