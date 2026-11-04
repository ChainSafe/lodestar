const std = @import("std");
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const BLSPubkey = types.primitive.BLSPubkey.Type;
const WithdrawalCredentials = types.primitive.Root.Type;
const BLSSignature = types.primitive.BLSSignature.Type;
const DepositMessage = types.phase0.DepositMessage.Type;
const Domain = types.primitive.Domain.Type;
const Root = types.primitive.Root.Type;
const types = @import("consensus_types");
const c = @import("constants");
const preset = @import("preset").preset;
const DOMAIN_DEPOSIT = c.DOMAIN_DEPOSIT;
const ZERO_HASH = @import("constants").ZERO_HASH;
const computeDomain = @import("../utils/domain.zig").computeDomain;
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const bls = @import("bls");
const verify = @import("../utils/bls.zig").verify;
const getMaxEffectiveBalance = @import("../utils/validator.zig").getMaxEffectiveBalance;
const increaseBalance = @import("../utils/balance.zig").increaseBalance;
const verifyMerkleBranch = @import("../utils/verify_merkle_branch.zig").verifyMerkleBranch;

pub const DepositData = union(enum) {
    phase0: types.phase0.DepositData.Type,
    electra: types.electra.DepositRequest.Type,

    pub fn pubkey(self: *const DepositData) *const BLSPubkey {
        return switch (self.*) {
            .phase0 => |*data| &data.pubkey,
            .electra => |*data| &data.pubkey,
        };
    }

    pub fn withdrawalCredentials(self: *const DepositData) *const WithdrawalCredentials {
        return switch (self.*) {
            .phase0 => |*data| &data.withdrawal_credentials,
            .electra => |*data| &data.withdrawal_credentials,
        };
    }

    pub fn amount(self: *const DepositData) u64 {
        return switch (self.*) {
            .phase0 => |data| data.amount,
            .electra => |data| data.amount,
        };
    }

    pub fn signature(self: *const DepositData) BLSSignature {
        return switch (self.*) {
            .phase0 => |data| data.signature,
            .electra => |data| data.signature,
        };
    }
};

pub fn processDeposit(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    deposit: *const types.phase0.Deposit.Type,
) !void {
    // verify the merkle branch
    var deposit_data_root: Root = undefined;
    try types.phase0.DepositData.hashTreeRoot(&deposit.data, &deposit_data_root);

    var eth1_data = try state.eth1Data();
    const deposit_root = try eth1_data.getFieldRoot("deposit_root");
    if (!verifyMerkleBranch(
        deposit_data_root,
        &deposit.proof,
        c.DEPOSIT_CONTRACT_TREE_DEPTH + 1,
        @intCast(try state.eth1DepositIndex()),
        deposit_root.*,
    )) {
        return error.InvalidMerkleProof;
    }

    // deposits must be processed in order
    try state.incrementEth1DepositIndex();
    try applyDeposit(fork, io, config, epoch_cache, state, &.{
        .phase0 = deposit.data,
    });
}

/// Adds a new validator into the registry. Or increase balance if already exist.
/// Follows applyDeposit() in consensus spec. Will be used by processDeposit() and processDepositRequest()
pub fn applyDeposit(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    deposit: *const DepositData,
) !void {
    const pubkey = deposit.pubkey();
    const withdrawal_credentials = deposit.withdrawalCredentials();
    const amount = deposit.amount();
    const signature = deposit.signature();

    const cached_index = epoch_cache.pubkey_cache.get(io, pubkey.*);
    const is_new_validator = cached_index == null or cached_index.? >= try state.validatorsCount();

    if (comptime fork.lt(.electra)) {
        if (is_new_validator) {
            if (validateDepositSignature(config, pubkey, withdrawal_credentials, amount, signature)) {
                try addValidatorToRegistry(fork, io, epoch_cache, state, pubkey, withdrawal_credentials, amount);
            } else |_| {
                // invalid deposit signature, ignore the deposit
                // TODO may be a useful metric to track
            }
        } else {
            // increase balance by deposit amount right away pre-electra
            const index = cached_index.?;
            try increaseBalance(fork, state, index, amount);
        }
    } else {
        const pending_deposit = types.electra.PendingDeposit.Type{
            .pubkey = pubkey.*,
            .withdrawal_credentials = withdrawal_credentials.*,
            .amount = amount,
            .signature = signature,
            .slot = c.GENESIS_SLOT, // Use GENESIS_SLOT to distinguish from a pending deposit request
        };

        var pending_deposits = try state.pendingDeposits();
        if (is_new_validator) {
            if (validateDepositSignature(config, pubkey, withdrawal_credentials, amount, signature)) {
                try addValidatorToRegistry(fork, io, epoch_cache, state, pubkey, withdrawal_credentials, 0);
                try pending_deposits.pushValue(&pending_deposit);
            } else |_| {
                // invalid deposit signature, ignore the deposit
                // TODO may be a useful metric to track
            }
        } else {
            try pending_deposits.pushValue(&pending_deposit);
        }
    }
}

pub fn addValidatorToRegistry(
    comptime fork: ForkSeq,
    io: std.Io,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    pubkey: *const BLSPubkey,
    withdrawal_credentials: *const WithdrawalCredentials,
    amount: u64,
) !void {
    var validators = try state.validators();
    // add validator and balance entries
    const effective_balance = @min(
        amount - (amount % preset.EFFECTIVE_BALANCE_INCREMENT),
        if (comptime fork.lt(.electra)) preset.MAX_EFFECTIVE_BALANCE else getMaxEffectiveBalance(withdrawal_credentials),
    );

    const validator: types.phase0.Validator.Type = .{
        .pubkey = pubkey.*,
        .withdrawal_credentials = withdrawal_credentials.*,
        .activation_eligibility_epoch = c.FAR_FUTURE_EPOCH,
        .activation_epoch = c.FAR_FUTURE_EPOCH,
        .exit_epoch = c.FAR_FUTURE_EPOCH,
        .withdrawable_epoch = c.FAR_FUTURE_EPOCH,
        .effective_balance = effective_balance,
        .slashed = false,
    };

    try validators.pushValue(&validator);

    const validator_index = (try validators.length()) - 1;
    // In Electra, new validators start with amount=0 (actual deposit goes through pendingDeposits)
    // Updating here is better than updating at once on epoch transition
    // - Simplify genesis fn applyDeposits(): effectiveBalanceIncrements is populated immediately
    // - Keep related code together to reduce risk of breaking this cache
    // - Should have equal performance since it sets a value in a flat array
    try epoch_cache.effectiveBalanceIncrementsAppend(validator_index, effective_balance);

    try epoch_cache.pubkey_cache.append(io, pubkey.*, validator_index);

    // Only after altair:
    if (comptime fork.gte(.altair)) {
        var inactivity_scores = try state.inactivityScores();
        try inactivity_scores.push(0);

        // add participation caches
        var previous_epoch_participation = try state.previousEpochParticipation();
        try previous_epoch_participation.push(0);
        var state_current_epoch_participation = try state.currentEpochParticipation();
        try state_current_epoch_participation.push(0);
    }
    var balances = try state.balances();
    try balances.push(amount);
}

/// refer to https://github.com/ethereum/consensus-specs/blob/v1.5.0/specs/electra/beacon-chain.md#new-is_valid_deposit_signature
pub fn validateDepositSignature(
    config: *const BeaconConfig,
    pubkey: *const BLSPubkey,
    withdrawal_credentials: *const WithdrawalCredentials,
    amount: u64,
    deposit_signature: BLSSignature,
) !void {
    // verify the deposit signature (proof of posession) which is not checked by the deposit contract
    const deposit_message = DepositMessage{
        .pubkey = pubkey.*,
        .withdrawal_credentials = withdrawal_credentials.*,
        .amount = amount,
    };

    const GENESIS_FORK_VERSION = config.chain.GENESIS_FORK_VERSION;

    // fork-agnostic domain since deposits are valid across forks
    var domain: Domain = undefined;
    try computeDomain(DOMAIN_DEPOSIT, GENESIS_FORK_VERSION, ZERO_HASH, &domain);
    var signing_root: Root = undefined;
    try computeSigningRoot(types.phase0.DepositMessage, &deposit_message, &domain, &signing_root);

    // Pubkeys must be checked for group + inf. This must be done only once when the validator deposit is processed
    const public_key = try bls.PublicKey.uncompress(pubkey);
    try public_key.validate();
    const signature = try bls.Signature.uncompress(&deposit_signature);
    try signature.validate(true);
    try verify(&signing_root, &public_key, &signature, .{});
}
