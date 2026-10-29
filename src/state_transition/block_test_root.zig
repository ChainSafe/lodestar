// Root file to run only state_transition/block tests.
//
// This exists because `zig test` compiles the entire root module before applying
// `--test-filter`. Keeping a small root lets us iterate on block processing
// without fixing unrelated compilation errors across the whole state_transition module.

test "state_transition block" {
    _ = @import("block/initiate_validator_exit.zig");
    _ = @import("block/is_valid_indexed_attestation.zig");
    _ = @import("block/process_attestation_altair.zig");
    _ = @import("block/process_attestation_phase0.zig");
    _ = @import("block/process_attestations.zig");
    _ = @import("block/process_attester_slashing.zig");
    _ = @import("block/process_blob_kzg_commitments.zig");
    _ = @import("block/process_block.zig");
    _ = @import("block/process_block_header.zig");
    _ = @import("block/process_bls_to_execution_change.zig");
    _ = @import("block/process_consolidation_request.zig");
    _ = @import("block/process_deposit.zig");
    _ = @import("block/process_deposit_request.zig");
    _ = @import("block/process_eth1_data.zig");
    _ = @import("block/process_execution_payload.zig");
    _ = @import("block/process_operations.zig");
    _ = @import("block/process_proposer_slashing.zig");
    _ = @import("block/process_randao.zig");
    _ = @import("block/process_sync_committee.zig");
    _ = @import("block/process_voluntary_exit.zig");
    _ = @import("block/process_withdrawal_request.zig");
    _ = @import("block/process_withdrawals.zig");
    _ = @import("block/slash_validator.zig");
}
