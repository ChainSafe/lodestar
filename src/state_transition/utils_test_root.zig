// Root file to run only state_transition/utils tests.
//
// This exists because `zig test` compiles the entire root module before applying
// `--test-filter`. Keeping a small root lets us iterate on a subset without
// fixing unrelated compilation errors across the whole state_transition module.

test "state_transition utils" {
    _ = @import("utils/aggregator.zig");
    _ = @import("utils/attestation.zig");
    _ = @import("utils/attester_status.zig");
    _ = @import("utils/balance.zig");
    _ = @import("utils/block_root.zig");
    _ = @import("utils/bls.zig");
    _ = @import("utils/capella.zig");
    _ = @import("utils/committee_indices.zig");
    _ = @import("utils/deposit.zig");
    _ = @import("utils/domain.zig");
    _ = @import("utils/electra.zig");
    _ = @import("utils/epoch.zig");
    _ = @import("utils/epoch_shuffling.zig");
    _ = @import("utils/execution.zig");
    _ = @import("utils/finality.zig");
    _ = @import("utils/process_proposer_lookahead.zig");
    _ = @import("utils/pubkey_index_map.zig");
    _ = @import("utils/ref_count.zig");
    _ = @import("utils/seed.zig");
    _ = @import("utils/signature_sets.zig");
    _ = @import("utils/signing_root.zig");
    _ = @import("utils/sync_committee.zig");
    _ = @import("utils/target_unslashed_balance.zig");
    _ = @import("utils/validator.zig");
    _ = @import("utils/verify_merkle_branch.zig");
}
