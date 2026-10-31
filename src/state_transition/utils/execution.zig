const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const ForkTypes = @import("fork_types").ForkTypes;
const BeaconState = @import("fork_types").BeaconState;
const BeaconBlock = @import("fork_types").BeaconBlock;
const BeaconBlockBody = @import("fork_types").BeaconBlockBody;
const BlockType = @import("fork_types").BlockType;
const ZERO_HASH = @import("constants").ZERO_HASH;

pub fn isExecutionEnabled(comptime fork: ForkSeq, state: *BeaconState(fork), comptime block_type: BlockType, block: *const BeaconBlock(block_type, fork)) bool {
    if (comptime fork.lt(.bellatrix)) return false;
    // Gloas (ePBS): execution is always enabled, payload is decoupled from the block
    if (comptime fork.gte(.gloas)) return true;
    if (isMergeTransitionComplete(fork, state)) return true;

    switch (block_type) {
        inline .blinded => {
            return !ForkTypes(fork).ExecutionPayloadHeader.equals(&block.body().inner.execution_payload_header, &ForkTypes(fork).ExecutionPayloadHeader.default_value);
        },
        inline .full => {
            return !ForkTypes(fork).ExecutionPayload.equals(&block.body().inner.execution_payload, &ForkTypes(fork).ExecutionPayload.default_value);
        },
    }
}

pub fn isMergeTransitionComplete(comptime fork: ForkSeq, state: *BeaconState(fork)) bool {
    if (comptime fork.lt(.bellatrix)) {
        return false;
    }
    if (comptime fork.gte(.capella)) {
        return true;
    }
    const block_hash = state.latestExecutionPayloadHeaderBlockHash() catch return false;
    return !std.mem.eql(u8, block_hash[0..], ZERO_HASH[0..]);
}
