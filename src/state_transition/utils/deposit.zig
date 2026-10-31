const preset = @import("preset").preset;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const types = @import("consensus_types");
const Eth1Data = types.phase0.Eth1Data.Type;
const MAX_DEPOSITS = preset.MAX_DEPOSITS;

pub fn getEth1DepositCount(comptime fork: ForkSeq, state: *BeaconState(fork), eth1_data: ?*const Eth1Data) !u64 {
    const deposit_count: u64 = if (eth1_data) |d| d.deposit_count else blk: {
        var eth1_data_view = try state.eth1Data();
        break :blk try eth1_data_view.get("deposit_count");
    };

    const eth1_deposit_index = try state.eth1DepositIndex();

    if (comptime fork.gte(.electra)) {
        const deposit_requests_start_index = try state.depositRequestsStartIndex();
        const eth1_data_index_limit: u64 = if (deposit_count < deposit_requests_start_index)
            deposit_count
        else
            deposit_requests_start_index;

        return if (eth1_deposit_index < eth1_data_index_limit)
            @min(MAX_DEPOSITS, eth1_data_index_limit - eth1_deposit_index)
        else
            0;
    }

    return @min(MAX_DEPOSITS, deposit_count - eth1_deposit_index);
}
