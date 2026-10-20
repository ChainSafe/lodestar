const std = @import("std");
const Allocator = std.mem.Allocator;
const config = @import("config");
const ForkSeq = config.ForkSeq;
const ForkTypes = @import("fork_types").ForkTypes;
const BeaconState = @import("fork_types").BeaconState;
const BlockType = @import("fork_types").BlockType;
const BeaconBlockBody = @import("fork_types").BeaconBlockBody;
const BlockExternalData = @import("../state_transition.zig").BlockExternalData;
const BeaconConfig = config.BeaconConfig;
const isMergeTransitionComplete = @import("../utils/execution.zig").isMergeTransitionComplete;
const getRandaoMix = @import("../utils/seed.zig").getRandaoMix;

pub fn processExecutionPayload(
    comptime fork: ForkSeq,
    allocator: Allocator,
    beacon_config: *const BeaconConfig,
    state: *BeaconState(fork),
    current_epoch: u64,
    comptime block_type: BlockType,
    body: *const BeaconBlockBody(block_type, fork),
    external_data: BlockExternalData,
) !void {
    const parent_hash, const prev_randao, const timestamp = switch (block_type) {
        .full => .{
            body.executionPayload().parentHash(),
            body.executionPayload().prevRandao(),
            body.executionPayload().timestamp(),
        },
        .blinded => .{
            body.executionPayloadHeader().parentHash(),
            body.executionPayloadHeader().prevRandao(),
            body.executionPayloadHeader().timestamp(),
        },
    };

    // Verify consistency of the parent hash, block number, base fee per gas and gas limit
    // with respect to the previous execution payload header
    if (isMergeTransitionComplete(fork, state)) {
        const latest_block_hash = try state.latestExecutionPayloadHeaderBlockHash();
        if (!std.mem.eql(u8, parent_hash, latest_block_hash)) {
            return error.InvalidExecutionPayloadParentHash;
        }
    }

    // Verify random
    const expected_random = try getRandaoMix(fork, state, current_epoch);
    if (!std.mem.eql(u8, prev_randao, expected_random)) {
        return error.InvalidExecutionPayloadRandom;
    }

    // Verify timestamp
    //
    // Note: inlined function in if statement
    // def compute_timestamp_at_slot(state: BeaconState, slot: Slot) -> uint64:
    //   slots_since_genesis = slot - GENESIS_SLOT
    //   return uint64(state.genesis_time + slots_since_genesis * SECONDS_PER_SLOT)
    if (timestamp != (try state.genesisTime()) + (try state.slot()) * beacon_config.chain.SECONDS_PER_SLOT) {
        return error.InvalidExecutionPayloadTimestamp;
    }

    if (comptime fork.gte(.deneb)) {
        const max_blobs_per_block = beacon_config.getMaxBlobsPerBlock(current_epoch);
        if (body.blobKzgCommitments().len > max_blobs_per_block) {
            return error.BlobKzgCommitmentsExceedsLimit;
        }
    }

    // Verify the execution payload is valid
    //
    // if executionEngine is null, executionEngine.onPayload MUST be called after running processBlock to get the
    // correct randao mix. Since executionEngine will be an async call in most cases it is called afterwards to keep
    // the state transition sync
    //
    // Equivalent to `assert executionEngine.notifyNewPayload(payload)
    if (block_type == .full and external_data.execution_payload_status != .valid) {
        return error.InvalidExecutionPayload;
    }

    var payload_header = ForkTypes(fork).ExecutionPayloadHeader.default_value;
    switch (block_type) {
        .full => try body.executionPayload().createExecutionPayloadHeader(allocator, &payload_header),
        .blinded => {
            errdefer ForkTypes(fork).ExecutionPayloadHeader.deinit(allocator, &payload_header);

            try ForkTypes(fork).ExecutionPayloadHeader.clone(
                allocator,
                &body.executionPayloadHeader().inner,
                &payload_header,
            );
        },
    }
    defer ForkTypes(fork).ExecutionPayloadHeader.deinit(allocator, &payload_header);

    try state.setLatestExecutionPayloadHeader(&payload_header);
}

test {
    _ = @import("process_execution_payload_test.zig");
}
