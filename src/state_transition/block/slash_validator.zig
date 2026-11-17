const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const types = @import("consensus_types");
const preset = @import("preset").preset;
const c = @import("constants");
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const BeaconState = @import("fork_types").BeaconState;
const ForkTypes = @import("fork_types").ForkTypes;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const ProposerRewards = @import("../cache/state_cache.zig").ProposerRewards;
const SlashingsCache = @import("../cache/slashings_cache.zig").SlashingsCache;
const decreaseBalance = @import("../utils/balance.zig").decreaseBalance;
const increaseBalance = @import("../utils/balance.zig").increaseBalance;
const initiateValidatorExit = @import("./initiate_validator_exit.zig").initiateValidatorExit;
const getBeaconProposer = @import("../cache/get_beacon_proposer.zig").getBeaconProposer;

/// Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag
const TIMELY_TARGET = 1 << c.TIMELY_TARGET_FLAG_INDEX;

pub fn slashValidator(
    comptime fork: ForkSeq,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    proposer_rewards: *ProposerRewards,
    slashings_cache: *SlashingsCache,
    slashed_index: ValidatorIndex,
    whistle_blower_index: ?ValidatorIndex,
) !void {
    const epoch = epoch_cache.epoch;
    const effective_balance_increments = epoch_cache.effective_balance_increments;
    const slashed_effective_balance_increments = effective_balance_increments.get().items[@intCast(slashed_index)];

    var validators = try state.validators();
    var validator = try validators.get(@intCast(slashed_index));

    // TODO: Bellatrix initiateValidatorExit validators.update() with the one below
    try initiateValidatorExit(fork, config, epoch_cache, state, validator);

    try validator.set("slashed", true);
    var latest_block_header = try state.latestBlockHeader();
    const latest_block_slot = try latest_block_header.get("slot");
    try slashings_cache.recordValidatorSlashing(latest_block_slot, slashed_index);
    const cur_withdrawable_epoch = try validator.get("withdrawable_epoch");
    try validator.set(
        "withdrawable_epoch",
        @max(cur_withdrawable_epoch, epoch + preset.EPOCHS_PER_SLASHINGS_VECTOR),
    );

    const effective_balance = try validator.get("effective_balance");

    // state.slashings is initially a Gwei (BigInt) vector, however since Nov 2023 it's converted to UintNum64 (number) vector in the state transition because:
    //  - state.slashings[nextEpoch % EPOCHS_PER_SLASHINGS_VECTOR] is reset per epoch in processSlashingsReset()
    //  - max slashed validators per epoch is SLOTS_PER_EPOCH * MAX_ATTESTER_SLASHINGS * MAX_VALIDATORS_PER_COMMITTEE which is 32 * 2 * 2048 = 131072 on mainnet
    //  - with that and 32_000_000_000 MAX_EFFECTIVE_BALANCE or 2048_000_000_000 MAX_EFFECTIVE_BALANCE_ELECTRA, it still fits in a number given that Math.floor(Number.MAX_SAFE_INTEGER / 32_000_000_000) = 281474
    //  - we don't need to compute the total slashings from state.slashings, it's handled by totalSlashingsByIncrement in EpochCache
    const slashing_index = epoch % preset.EPOCHS_PER_SLASHINGS_VECTOR;
    var slashings = try state.slashings();
    const cur_slashings = try slashings.get(@intCast(slashing_index));
    try slashings.set(@intCast(slashing_index), cur_slashings + effective_balance);
    epoch_cache.total_slashings_by_increment += slashed_effective_balance_increments;

    const min_slashing_penalty_quotient: usize = switch (fork) {
        .phase0 => preset.MIN_SLASHING_PENALTY_QUOTIENT,
        .altair => preset.MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR,
        .bellatrix, .capella, .deneb => preset.MIN_SLASHING_PENALTY_QUOTIENT_BELLATRIX,
        .electra, .fulu, .gloas, .heze => preset.MIN_SLASHING_PENALTY_QUOTIENT_ELECTRA,
    };

    try decreaseBalance(fork, state, slashed_index, @divFloor(effective_balance, min_slashing_penalty_quotient));

    // apply proposer and whistleblower rewards
    const whistleblower_reward = switch (fork) {
        .electra, .fulu, .gloas, .heze => @divFloor(effective_balance, preset.WHISTLEBLOWER_REWARD_QUOTIENT_ELECTRA),
        else => @divFloor(effective_balance, preset.WHISTLEBLOWER_REWARD_QUOTIENT),
    };

    const proposer_reward = switch (fork) {
        .phase0 => @divFloor(whistleblower_reward, preset.PROPOSER_REWARD_QUOTIENT),
        else => @divFloor(whistleblower_reward * c.PROPOSER_WEIGHT, c.WEIGHT_DENOMINATOR),
    };

    const proposer_index = try getBeaconProposer(fork, epoch_cache, state, try state.slot());

    if (whistle_blower_index) |_whistle_blower_index| {
        try increaseBalance(fork, state, proposer_index, proposer_reward);
        try increaseBalance(fork, state, _whistle_blower_index, whistleblower_reward - proposer_reward);
        proposer_rewards.slashing += proposer_reward;
    } else {
        try increaseBalance(fork, state, proposer_index, whistleblower_reward);
        proposer_rewards.slashing += whistleblower_reward;
    }

    if (comptime fork.gte(.gloas)) {
        var payments = try state.inner.get("builder_pending_payments");
        for (0..2 * preset.SLOTS_PER_EPOCH) |i| {
            var payment: ForkTypes(fork).BuilderPendingPayment.Type = undefined;
            try payments.getValue(undefined, i, &payment);
            if (payment.proposer_index == slashed_index) try payments.setValue(i, &ForkTypes(fork).BuilderPendingPayment.default_value);
        }
    }

    if (fork.gte(.altair)) {
        var previous_participation = try state.previousEpochParticipation();
        if ((try previous_participation.get(@intCast(slashed_index))) & TIMELY_TARGET == TIMELY_TARGET) {
            if (epoch_cache.previous_target_unslashed_balance_increments < slashed_effective_balance_increments) {
                return error.PreviousTargetUnslashedBalanceUnderflow;
            }
            epoch_cache.previous_target_unslashed_balance_increments -= slashed_effective_balance_increments;
        }

        var current_participation = try state.currentEpochParticipation();
        if ((try current_participation.get(@intCast(slashed_index))) & TIMELY_TARGET == TIMELY_TARGET) {
            if (epoch_cache.current_target_unslashed_balance_increments < slashed_effective_balance_increments) {
                return error.CurrentTargetUnslashedBalanceUnderflow;
            }
            epoch_cache.current_target_unslashed_balance_increments -= slashed_effective_balance_increments;
        }
    }
}
