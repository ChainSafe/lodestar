const c = @import("constants");
const COMPOUNDING_WITHDRAWAL_PREFIX = c.COMPOUNDING_WITHDRAWAL_PREFIX;
const MIN_ACTIVATION_BALANCE = @import("preset").preset.MIN_ACTIVATION_BALANCE;
const GENESIS_SLOT = @import("preset").GENESIS_SLOT;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const ct = @import("consensus_types");

pub const WithdrawalCredentials = ct.primitive.Root.Type;
const ValidatorIndex = ct.primitive.ValidatorIndex.Type;

const hasEth1WithdrawalCredential = @import("./capella.zig").hasEth1WithdrawalCredential;
const G2_POINT_AT_INFINITY = @import("constants").G2_POINT_AT_INFINITY;
const pq = @import("./pq.zig");

pub fn hasCompoundingWithdrawalCredential(withdrawal_credentials: *const WithdrawalCredentials) bool {
    return withdrawal_credentials[0] == COMPOUNDING_WITHDRAWAL_PREFIX;
}

pub fn hasExecutionWithdrawalCredential(withdrawal_credentials: *const WithdrawalCredentials) bool {
    return hasCompoundingWithdrawalCredential(withdrawal_credentials) or hasEth1WithdrawalCredential(withdrawal_credentials);
}

pub fn switchToCompoundingValidator(comptime fork: ForkSeq, state: *BeaconState(fork), index: ValidatorIndex) !void {
    var validators = try state.validators();
    var validator = try validators.get(index);
    const old_withdrawal_credentials = try validator.getFieldRoot("withdrawal_credentials");

    var new_withdrawal_credentials: [32]u8 = undefined;
    @memcpy(new_withdrawal_credentials[0..], old_withdrawal_credentials[0..]);
    new_withdrawal_credentials[0] = COMPOUNDING_WITHDRAWAL_PREFIX;

    try validator.setValue("withdrawal_credentials", &new_withdrawal_credentials);

    const pubkey: ct.primitive.BLSPubkey.Type = if (comptime fork == .pq) blk: {
        var xmss_pubkey: [32]u8 = undefined;
        try validator.getValue(undefined, "pubkey", &xmss_pubkey);
        break :blk pq.requestPubkey(&xmss_pubkey);
    } else blk: {
        var bls_pubkey: ct.primitive.BLSPubkey.Type = undefined;
        try validator.getValue(undefined, "pubkey", &bls_pubkey);
        break :blk bls_pubkey;
    };

    try queueExcessActiveBalance(
        fork,
        state,
        index,
        &new_withdrawal_credentials,
        pubkey,
    );
}

pub fn queueExcessActiveBalance(
    comptime fork: ForkSeq,
    state: *BeaconState(fork),
    index: ValidatorIndex,
    withdrawal_credentials: *const WithdrawalCredentials,
    pubkey: ct.primitive.BLSPubkey.Type,
) !void {
    var balances = try state.balances();
    const balance = try balances.get(index);
    if (balance > MIN_ACTIVATION_BALANCE) {
        const excess_balance = balance - MIN_ACTIVATION_BALANCE;
        try balances.set(index, MIN_ACTIVATION_BALANCE);

        const pending_deposit = ct.electra.PendingDeposit.Type{
            .pubkey = pubkey,
            .withdrawal_credentials = withdrawal_credentials.*,
            .amount = excess_balance,
            // A placeholder: the point at infinity, or from PQ, where deposits carry no signature, zeroes.
            .signature = if (comptime fork == .pq) @splat(0) else G2_POINT_AT_INFINITY,
            //  Use GENESIS_SLOT to distinguish from a pending deposit request
            .slot = GENESIS_SLOT,
        };
        var pending_deposits = try state.pendingDeposits();
        try pending_deposits.pushValue(&pending_deposit);
    }
}

pub fn isValidatorKnown(comptime fork: ForkSeq, state: *BeaconState(fork), index: ?ValidatorIndex) !bool {
    const validator_index = index orelse return false;
    const validators_count = try state.validatorsCount();
    return validator_index < validators_count;
}
