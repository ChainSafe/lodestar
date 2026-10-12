const std = @import("std");
const Allocator = std.mem.Allocator;
const m = @import("metrics");

/// Defaults to noop metrics, making this safe to use whether or not `metrics.init` is called.
pub threadlocal var state_transition = m.initializeNoop(Metrics);

/// Validator monitor metrics.
///
/// Defaults to noop metrics, making this safe to use whether or not `metrics.init` is called.
pub threadlocal var validator_monitor = m.initializeNoop(ValidatorMonitorMetrics);

pub const StateHashTreeRootSource = enum {
    state_transition,
    block_transition,
    prepare_next_slot,
    prepare_next_epoch,
    regen_state,
    compute_new_state_root,
};

/// Consumer-facing source of a block-processing transition.
pub const ProcessBlockSource = enum {
    block,
    regen,
    get_historical_state,
};

pub const EpochTransitionStepKind = enum {
    before_process_epoch,
    after_process_epoch,
    final_process_epoch,
    process_justification_and_finalization,
    process_inactivity_updates,
    process_registry_updates,
    process_slashings,
    process_rewards_and_penalties,
    process_effective_balance_updates,
    process_participation_flag_updates,
    process_sync_committee_updates,
    process_pending_deposits,
    process_pending_consolidations,
    process_proposer_lookahead,
};

pub const ProcessBlockStepKind = enum {
    processBlockHeader,
    processWithdrawals,
    processExecutionPayload,
    processRandao,
    processEth1Data,
    processOperations,
    processSyncAggregate,
    processBlobKzgCommitments,
};

pub const ProcessOperationsStepKind = enum {
    processProposerSlashing,
    processAttesterSlashing,
    processAttestations,
    processDeposit,
    processVoluntaryExit,
    processBlsToExecutionChange,
    processDepositRequest,
    processWithdrawalRequest,
    processConsolidationRequest,
};

pub const ProposerRewardKind = enum {
    attestation,
    sync_aggregate,
    slashing,
};

const HashTreeRootLabel = struct { source: StateHashTreeRootSource };
const ProcessBlockLabel = struct { source: ProcessBlockSource };
const EpochTransitionStepLabel = struct { step: EpochTransitionStepKind };
const ProcessBlockStepLabel = struct { step: ProcessBlockStepKind };
const ProcessOperationsStepLabel = struct { step: ProcessOperationsStepKind };
const ProposerRewardLabel = struct { type: ProposerRewardKind };
const ProgressiveBalancesMismatchLabel = struct { target: ProgressiveBalancesTarget };

const ProgressiveBalancesTarget = enum { current, previous };

const Metrics = struct {
    epoch_transition: EpochTransition,
    epoch_transition_commit: EpochTransitionCommit,
    epoch_transition_step: EpochTransitionStep,
    epoch_shuffling_job: EpochShufflingJob,
    process_block: ProcessBlock,
    process_block_step: ProcessBlockStep,
    process_operations_step: ProcessOperationsStep,
    process_block_commit: ProcessBlockCommit,
    state_hash_tree_root: StateHashTreeRoot,
    num_effective_balance_updates: CountGauge,
    validators_in_activation_queue: CountGauge,
    validators_in_exit_queue: CountGauge,
    pre_state_cloned_count: PreStateClonedCount,
    post_state_balances_nodes_populated_hit: CountGauge,
    post_state_balances_nodes_populated_miss: CountGauge,
    post_state_validators_nodes_populated_hit: CountGauge,
    post_state_validators_nodes_populated_miss: CountGauge,
    new_seen_attesters_per_block: CountGauge,
    new_seen_attesters_effective_balance_per_block: CountGauge,
    attestations_per_block: CountGauge,
    proposer_rewards: ProposerRewardsGauge,
    progressive_balances_mismatches: ProgressiveBalancesMismatches,

    const EpochTransition = m.Histogram(f64, &.{ 0.01, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 1, 3 });
    const EpochTransitionCommit = m.Histogram(f64, &.{ 0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1 });
    const EpochTransitionStep = m.HistogramVec(f64, EpochTransitionStepLabel, &.{ 0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1 });
    const EpochShufflingJob = m.Histogram(f64, &.{ 0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1 });
    const ProcessBlock = m.HistogramVec(f64, ProcessBlockLabel, &.{ 0.005, 0.01, 0.02, 0.05, 0.1, 1 });
    const ProcessBlockStep = m.HistogramVec(f64, ProcessBlockStepLabel, &.{ 0.001, 0.005, 0.01, 0.025, 0.05, 0.1 });
    const ProcessOperationsStep = m.HistogramVec(f64, ProcessOperationsStepLabel, &.{ 0.001, 0.005, 0.01, 0.025, 0.05, 0.1 });
    const ProcessBlockCommit = m.Histogram(f64, &.{ 0.005, 0.01, 0.02, 0.05, 0.1, 1 });
    const StateHashTreeRoot = m.HistogramVec(f64, HashTreeRootLabel, &.{ 0.05, 0.1, 0.2, 0.5, 1, 1.5 });
    const CountGauge = m.Gauge(u64);
    const PreStateClonedCount = m.Histogram(u32, &.{ 1, 2, 5, 10, 50, 250 });
    const ProposerRewardsGauge = m.GaugeVec(u64, ProposerRewardLabel);
    const ProgressiveBalancesMismatches = m.CounterVec(u64, ProgressiveBalancesMismatchLabel);

    /// Deinitializes all `HistogramVec` and `GaugeVec` metrics for state transition.
    pub fn deinit(self: *Metrics) void {
        self.epoch_transition_step.deinit();
        self.process_block.deinit();
        self.process_block_step.deinit();
        self.process_operations_step.deinit();
        self.state_hash_tree_root.deinit();
        self.proposer_rewards.deinit();
        self.progressive_balances_mismatches.deinit();
        self.* = m.initializeNoop(Metrics);
    }
};

/// Metrics recorded once per epoch transition for validators monitored by the `ValidatorMonitor`.
const ValidatorMonitorMetrics = struct {
    prev_epoch_on_chain_balance: CountGauge,
    prev_epoch_on_chain_source_attester_hit: CountGauge,
    prev_epoch_on_chain_source_attester_miss: CountGauge,
    prev_epoch_on_chain_head_attester_hit: CountGauge,
    prev_epoch_on_chain_head_attester_miss: CountGauge,
    prev_epoch_on_chain_target_attester_hit: CountGauge,
    prev_epoch_on_chain_target_attester_miss: CountGauge,

    const CountGauge = m.Gauge(u64);
};

/// Initializes all metrics for state transition. Requires an allocator for `GaugeVec` and `HistogramVec` metrics.
///
/// Meant to be called once on application startup.
pub fn init(allocator: Allocator, io: std.Io, comptime opts: m.RegistryOpts) !void {
    const metric_opts = comptime m.RegistryOpts{
        .prefix = if (opts.prefix.len == 0) "lodestar_" else opts.prefix,
        .exclude = opts.exclude,
    };

    var process_block = try Metrics.ProcessBlock.init(
        allocator,
        io,
        "stfn_process_block_seconds",
        .{ .help = "Time to process a single block in seconds" },
        metric_opts,
    );
    errdefer process_block.deinit();
    var epoch_transition_step = try Metrics.EpochTransitionStep.init(
        allocator,
        io,
        "stfn_epoch_transition_step_seconds",
        .{ .help = "Time to call each step of epoch transition in seconds" },
        metric_opts,
    );
    errdefer epoch_transition_step.deinit();
    var process_block_step = try Metrics.ProcessBlockStep.init(
        allocator,
        io,
        "stfn_process_block_step_seconds",
        .{ .help = "Time to call each step of process block in seconds" },
        metric_opts,
    );
    errdefer process_block_step.deinit();
    var process_operations_step = try Metrics.ProcessOperationsStep.init(
        allocator,
        io,
        "stfn_process_operations_step_seconds",
        .{ .help = "Time to call each step of process operations in seconds" },
        metric_opts,
    );
    errdefer process_operations_step.deinit();
    var state_hash_tree_root = try Metrics.StateHashTreeRoot.init(
        allocator,
        io,
        "stfn_hash_tree_root_seconds",
        .{ .help = "Time to compute the hash tree root of a post state in seconds" },
        metric_opts,
    );
    errdefer state_hash_tree_root.deinit();
    var proposer_rewards = try Metrics.ProposerRewardsGauge.init(
        allocator,
        io,
        "stfn_proposer_rewards_total",
        .{ .help = "Proposer reward by type per block" },
        metric_opts,
    );
    errdefer proposer_rewards.deinit();
    var progressive_balances_mismatches = try Metrics.ProgressiveBalancesMismatches.init(
        allocator,
        io,
        "stfn_progressive_balances_mismatches_total",
        .{ .help = "Total count of progressive balance cache mismatches by target balance" },
        metric_opts,
    );
    errdefer progressive_balances_mismatches.deinit();

    state_transition = .{
        .epoch_transition = Metrics.EpochTransition.init(
            "stfn_epoch_transition_seconds",
            .{ .help = "Time to process a single epoch transition in seconds" },
            metric_opts,
        ),
        .epoch_transition_commit = Metrics.EpochTransitionCommit.init(
            "stfn_epoch_transition_commit_seconds",
            .{ .help = "Time to call commit after process a single epoch transition in seconds" },
            metric_opts,
        ),
        .epoch_transition_step = epoch_transition_step,
        .epoch_shuffling_job = Metrics.EpochShufflingJob.init(
            "stfn_epoch_shuffling_job_seconds",
            .{ .help = "Time to build the next epoch shuffling in the shuffling job" },
            metric_opts,
        ),
        .process_block = process_block,
        .process_block_step = process_block_step,
        .process_operations_step = process_operations_step,
        .process_block_commit = Metrics.ProcessBlockCommit.init(
            "stfn_process_block_commit_seconds",
            .{ .help = "Time to call commit after process a single block in seconds" },
            metric_opts,
        ),
        .state_hash_tree_root = state_hash_tree_root,
        .num_effective_balance_updates = Metrics.CountGauge.init(
            "stfn_effective_balance_updates_count",
            .{ .help = "Total count of effective balance updates" },
            metric_opts,
        ),
        .validators_in_activation_queue = Metrics.CountGauge.init(
            "stfn_validators_in_activation_queue",
            .{ .help = "Current number of validators in the activation queue" },
            metric_opts,
        ),
        .validators_in_exit_queue = Metrics.CountGauge.init(
            "stfn_validators_in_exit_queue",
            .{ .help = "Current number of validators in the exit queue" },
            metric_opts,
        ),
        .pre_state_cloned_count = Metrics.PreStateClonedCount.init(
            "stfn_state_cloned_count",
            .{ .help = "Histogram of cloned count per state every time state.clone() is called" },
            metric_opts,
        ),
        .post_state_balances_nodes_populated_hit = Metrics.CountGauge.init(
            "stfn_post_state_balances_nodes_populated_hit_total",
            .{ .help = "Total count state.validators nodesPopulated is true on stfn for post state" },
            metric_opts,
        ),
        .post_state_balances_nodes_populated_miss = Metrics.CountGauge.init(
            "stfn_post_state_balances_nodes_populated_miss_total",
            .{ .help = "Total count state.validators nodesPopulated is false on stfn for post state" },
            metric_opts,
        ),
        .post_state_validators_nodes_populated_hit = Metrics.CountGauge.init(
            "stfn_post_state_validators_nodes_populated_hit_total",
            .{ .help = "Total count state.validators nodesPopulated is true on stfn for post state" },
            metric_opts,
        ),
        .post_state_validators_nodes_populated_miss = Metrics.CountGauge.init(
            "stfn_post_state_validators_nodes_populated_miss_total",
            .{ .help = "Total count state.validators nodesPopulated is false on stfn for post state" },
            metric_opts,
        ),
        .new_seen_attesters_per_block = Metrics.CountGauge.init(
            "stfn_new_seen_attesters_per_block_total",
            .{ .help = "Total count of new seen attesters per block" },
            metric_opts,
        ),
        .new_seen_attesters_effective_balance_per_block = Metrics.CountGauge.init(
            "stfn_new_seen_attesters_effective_balance_per_block_total",
            .{ .help = "Total effective balance increment of new seen attesters per block" },
            metric_opts,
        ),
        .attestations_per_block = Metrics.CountGauge.init(
            "stfn_attestations_per_block_total",
            .{ .help = "Total count of attestations per block" },
            metric_opts,
        ),
        .proposer_rewards = proposer_rewards,
        .progressive_balances_mismatches = progressive_balances_mismatches,
    };

    validator_monitor = .{
        .prev_epoch_on_chain_balance = ValidatorMonitorMetrics.CountGauge.init(
            "validator_monitor_prev_epoch_on_chain_balance",
            .{ .help = "Total balance of all monitored validators after an epoch" },
            opts,
        ),
        .prev_epoch_on_chain_source_attester_hit = ValidatorMonitorMetrics.CountGauge.init(
            "validator_monitor_prev_epoch_on_chain_source_attester_hit_total",
            .{ .help = "Incremented if the validator is flagged as a previous epoch source attester during per epoch processing" },
            opts,
        ),
        .prev_epoch_on_chain_source_attester_miss = ValidatorMonitorMetrics.CountGauge.init(
            "validator_monitor_prev_epoch_on_chain_source_attester_miss_total",
            .{ .help = "Incremented if the validator is not flagged as a previous epoch source attester during per epoch processing" },
            opts,
        ),
        .prev_epoch_on_chain_head_attester_hit = ValidatorMonitorMetrics.CountGauge.init(
            "validator_monitor_prev_epoch_on_chain_head_attester_hit_total",
            .{ .help = "Incremented if the validator is flagged as a previous epoch head attester during per epoch processing" },
            opts,
        ),
        .prev_epoch_on_chain_head_attester_miss = ValidatorMonitorMetrics.CountGauge.init(
            "validator_monitor_prev_epoch_on_chain_head_attester_miss_total",
            .{ .help = "Incremented if the validator is not flagged as a previous epoch head attester during per epoch processing" },
            opts,
        ),
        .prev_epoch_on_chain_target_attester_hit = ValidatorMonitorMetrics.CountGauge.init(
            "validator_monitor_prev_epoch_on_chain_target_attester_hit_total",
            .{ .help = "Incremented if the validator is flagged as a previous epoch target attester during per epoch processing" },
            opts,
        ),
        .prev_epoch_on_chain_target_attester_miss = ValidatorMonitorMetrics.CountGauge.init(
            "validator_monitor_prev_epoch_on_chain_target_attester_miss_total",
            .{ .help = "Incremented if the validator is not flagged as a previous epoch target attester during per epoch processing" },
            opts,
        ),
    };
}

/// Observe a value in ns for the `epoch_transition_step` labelled histogram.
pub fn observeEpochTransitionStep(
    labels: EpochTransitionStepLabel,
    ns: u64,
) !void {
    try state_transition.epoch_transition_step.observe(
        labels,
        @as(f64, @floatFromInt(ns)) / std.time.ns_per_s,
    );
}

/// Writes all metrics to `writer`.
pub fn write(writer: *std.Io.Writer) !void {
    try m.write(&state_transition, writer);
    try m.write(&validator_monitor, writer);
}

/// Deinitializes all metrics and resets them to noop, making it safe to keep
/// recording metrics (or call `init` again) afterwards.
pub fn deinit() void {
    state_transition.deinit();
    state_transition = m.initializeNoop(Metrics);
    validator_monitor = m.initializeNoop(ValidatorMonitorMetrics);
}

test "exports the expected metric names" {
    const allocator = std.testing.allocator;
    try init(allocator, std.testing.io, .{});
    defer deinit();

    try state_transition.process_block_step.observe(.{ .step = .processBlockHeader }, 0.001);
    try state_transition.process_operations_step.observe(.{ .step = .processAttestations }, 0.001);
    try state_transition.process_block.observe(.{ .source = .block }, 0.001);
    try state_transition.process_block.observe(.{ .source = .regen }, 0.001);
    try state_transition.process_block.observe(.{ .source = .get_historical_state }, 0.001);

    var aw: std.Io.Writer.Allocating = .init(allocator);
    defer aw.deinit();
    try write(&aw.writer);

    const expected = [_][]const u8{
        "lodestar_stfn_epoch_transition_seconds",
        "lodestar_stfn_epoch_transition_commit_seconds",
        "lodestar_stfn_epoch_transition_step_seconds",
        "lodestar_stfn_epoch_shuffling_job_seconds",
        "lodestar_stfn_process_block_seconds",
        "lodestar_stfn_process_block_step_seconds",
        "lodestar_stfn_process_operations_step_seconds",
        "lodestar_stfn_process_block_commit_seconds",
        "lodestar_stfn_hash_tree_root_seconds",
        "lodestar_stfn_effective_balance_updates_count",
        "lodestar_stfn_validators_in_activation_queue",
        "lodestar_stfn_validators_in_exit_queue",
        "lodestar_stfn_state_cloned_count",
        "lodestar_stfn_post_state_balances_nodes_populated_hit_total",
        "lodestar_stfn_post_state_balances_nodes_populated_miss_total",
        "lodestar_stfn_post_state_validators_nodes_populated_hit_total",
        "lodestar_stfn_post_state_validators_nodes_populated_miss_total",
        "lodestar_stfn_new_seen_attesters_per_block_total",
        "lodestar_stfn_new_seen_attesters_effective_balance_per_block_total",
        "lodestar_stfn_attestations_per_block_total",
        "lodestar_stfn_proposer_rewards_total",
        "lodestar_stfn_progressive_balances_mismatches_total",
        "validator_monitor_prev_epoch_on_chain_balance",
        "validator_monitor_prev_epoch_on_chain_source_attester_hit_total",
        "validator_monitor_prev_epoch_on_chain_source_attester_miss_total",
        "validator_monitor_prev_epoch_on_chain_head_attester_hit_total",
        "validator_monitor_prev_epoch_on_chain_head_attester_miss_total",
        "validator_monitor_prev_epoch_on_chain_target_attester_hit_total",
        "validator_monitor_prev_epoch_on_chain_target_attester_miss_total",
    };

    var names: std.ArrayList([]const u8) = .empty;
    defer names.deinit(allocator);
    var lines = std.mem.splitScalar(u8, aw.written(), '\n');
    while (lines.next()) |line| {
        if (!std.mem.startsWith(u8, line, "# TYPE ")) continue;
        var parts = std.mem.splitScalar(u8, line["# TYPE ".len..], ' ');
        try names.append(allocator, parts.next().?);
    }

    try std.testing.expectEqual(expected.len, names.items.len);
    for (expected, names.items) |name, actual| {
        try std.testing.expectEqualStrings(name, actual);
    }

    try std.testing.expect(std.mem.indexOf(
        u8,
        aw.written(),
        "lodestar_stfn_process_block_step_seconds_count{step=\"processBlockHeader\"} 1\n",
    ) != null);
    try std.testing.expect(std.mem.indexOf(
        u8,
        aw.written(),
        "lodestar_stfn_process_operations_step_seconds_count{step=\"processAttestations\"} 1\n",
    ) != null);
    try std.testing.expect(std.mem.indexOf(
        u8,
        aw.written(),
        "lodestar_stfn_process_block_seconds_count{source=\"block\"} 1\n",
    ) != null);
    try std.testing.expect(std.mem.indexOf(
        u8,
        aw.written(),
        "lodestar_stfn_process_block_seconds_count{source=\"regen\"} 1\n",
    ) != null);
    try std.testing.expect(std.mem.indexOf(
        u8,
        aw.written(),
        "lodestar_stfn_process_block_seconds_count{source=\"get_historical_state\"} 1\n",
    ) != null);
    try std.testing.expect(std.mem.indexOf(
        u8,
        aw.written(),
        "lodestar_stfn_process_block_seconds_sum{source=\"block\"} 0.001\n",
    ) != null);
}
