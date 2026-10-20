const BlockExternalData = @import("../state_transition.zig").BlockExternalData;

pub fn processBlobKzgCommitments(external_data: BlockExternalData) !void {
    if (external_data.execution_payload_status != .valid) {
        return error.InvalidExecutionPayload;
    }
}

test "process blob kzg commitments - sanity" {
    try processBlobKzgCommitments(.{
        .execution_payload_status = .valid,
        .data_availability_status = .available,
    });
}
