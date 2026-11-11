const std = @import("std");
const Allocator = std.mem.Allocator;
const ForkSeq = @import("config").ForkSeq;
const preregistrations = @import("process_preregistration_request.zig");
const pq = @import("../utils/pq.zig");
const BeaconState = @import("fork_types").BeaconState;
const types = @import("consensus_types");
const DepositRequest = types.electra.DepositRequest.Type;
const PendingDeposit = types.electra.PendingDeposit.Type;
const c = @import("constants");

pub fn processDepositRequest(comptime fork: ForkSeq, allocator: Allocator, state: *BeaconState(fork), deposit_request: *const DepositRequest) !void {
    // From PQ a deposit carries no signature. While a preregistration binds its key,
    // only a deposit that matches the binding is accepted, and it consumes the binding.
    if (comptime fork == .pq) {
        const pubkey = pq.computeDepositPubkey(&deposit_request.pubkey);
        if (try preregistrations.getActivePreregistration(state, &pubkey)) |preregistration| {
            if (!std.mem.eql(u8, &deposit_request.withdrawal_credentials, &preregistration.withdrawal_credentials)) return;
            if (!std.mem.eql(u8, deposit_request.signature[0..32], &preregistration.vrf_root)) return;
            try preregistrations.removeStoredPreregistration(allocator, state, &pubkey);
        }
    }
    if (comptime fork == .electra) {
        const deposit_requests_start_index = try state.depositRequestsStartIndex();
        if (deposit_requests_start_index == c.UNSET_DEPOSIT_REQUESTS_START_INDEX) {
            try state.setDepositRequestsStartIndex(deposit_request.index);
        }
    }

    const pending_deposit = PendingDeposit{
        .pubkey = deposit_request.pubkey,
        .withdrawal_credentials = deposit_request.withdrawal_credentials,
        .amount = deposit_request.amount,
        .signature = deposit_request.signature,
        .slot = try state.slot(),
    };

    var pending_deposits = try state.pendingDeposits();
    try pending_deposits.pushValue(&pending_deposit);
}
