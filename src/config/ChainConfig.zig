///! Full chain configuration for a specific Ethereum Beacon Chain network (e.g. mainnet).
///!
///! This struct mirrors the upstream configuration values used by the consensus spec,
///! see https://github.com/ethereum/consensus-specs/tree/master/configs.
const std = @import("std");
const Preset = @import("preset").Preset;

const ChainConfig = @This();

PRESET_BASE: Preset,
CONFIG_NAME: []const u8,

// Transition
TERMINAL_TOTAL_DIFFICULTY: u256,
TERMINAL_BLOCK_HASH: [32]u8,
TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH: u64,

// Genesis
MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: u64,
MIN_GENESIS_TIME: u64,
GENESIS_FORK_VERSION: [4]u8,
GENESIS_DELAY: u64,

// Altair
ALTAIR_FORK_VERSION: [4]u8,
ALTAIR_FORK_EPOCH: u64,
// Bellatrix
BELLATRIX_FORK_VERSION: [4]u8,
BELLATRIX_FORK_EPOCH: u64,
// Capella
CAPELLA_FORK_VERSION: [4]u8,
CAPELLA_FORK_EPOCH: u64,
// DENEB
DENEB_FORK_VERSION: [4]u8,
DENEB_FORK_EPOCH: u64,
// ELECTRA
ELECTRA_FORK_VERSION: [4]u8,
ELECTRA_FORK_EPOCH: u64,
// FULU (assuming it's a future fork, standard pattern)
FULU_FORK_VERSION: [4]u8,
FULU_FORK_EPOCH: u64,
// GLOAS
GLOAS_FORK_VERSION: [4]u8,
GLOAS_FORK_EPOCH: u64,
// HEZE
HEZE_FORK_VERSION: [4]u8,
HEZE_FORK_EPOCH: u64,

// Time parameters
SECONDS_PER_SLOT: u64,
SLOT_DURATION_MS: u64,
SLOT_DURATION_MS_HEZE: u64,
SECONDS_PER_ETH1_BLOCK: u64,
MIN_VALIDATOR_WITHDRAWABILITY_DELAY: u64,
SHARD_COMMITTEE_PERIOD: u64,
ETH1_FOLLOW_DISTANCE: u64,

// Validator cycle
INACTIVITY_SCORE_BIAS: u64,
INACTIVITY_SCORE_RECOVERY_RATE: u64,
EJECTION_BALANCE: u64,
MIN_PER_EPOCH_CHURN_LIMIT: u64,
MAX_PER_EPOCH_ACTIVATION_CHURN_LIMIT: u64,
CHURN_LIMIT_QUOTIENT: u64,
MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT: u64,
MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA: u64,

// Fork choice
PROPOSER_SCORE_BOOST: u64,
REORG_HEAD_WEIGHT_THRESHOLD: u64,
REORG_PARENT_WEIGHT_THRESHOLD: u64,
REORG_MAX_EPOCHS_SINCE_FINALIZATION: u64,
PROPOSER_REORG_CUTOFF_BPS: u64,

// Timing (basis points of slot duration)
ATTESTATION_DUE_BPS: u64,
ATTESTATION_DUE_BPS_GLOAS: u64,

// Gloas (EIP-7732)
AGGREGATE_DUE_BPS_GLOAS: u64,
SYNC_MESSAGE_DUE_BPS_GLOAS: u64,
CONTRIBUTION_DUE_BPS_GLOAS: u64,
PAYLOAD_DUE_BPS: u64,
PAYLOAD_ATTESTATION_DUE_BPS: u64,
MIN_BUILDER_WITHDRAWABILITY_DELAY: u64,
CHURN_LIMIT_QUOTIENT_GLOAS: u64,
CONSOLIDATION_CHURN_LIMIT_QUOTIENT: u64,
MAX_PER_EPOCH_ACTIVATION_CHURN_LIMIT_GLOAS: u64,

// Deposit contract
DEPOSIT_CHAIN_ID: u64,
DEPOSIT_NETWORK_ID: u64,
DEPOSIT_CONTRACT_ADDRESS: [20]u8,

// Networking
MIN_EPOCHS_FOR_BLOCK_REQUESTS: u64,
MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS: u64,
MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS: u64,
BLOB_SIDECAR_SUBNET_COUNT: u64,
MAX_BLOBS_PER_BLOCK: u64,
MAX_REQUEST_BLOB_SIDECARS: u64,
BLOB_SIDECAR_SUBNET_COUNT_ELECTRA: u64,
MAX_BLOBS_PER_BLOCK_ELECTRA: u64,
MAX_REQUEST_BLOB_SIDECARS_ELECTRA: u64,

SAMPLES_PER_SLOT: u64,
CUSTODY_REQUIREMENT: u64,
NODE_CUSTODY_REQUIREMENT: u64,
VALIDATOR_CUSTODY_REQUIREMENT: u64,
BALANCE_PER_ADDITIONAL_CUSTODY_GROUP: u64,

// Blob Scheduling
BLOB_SCHEDULE: []const BlobScheduleEntry,

/// One entry in the blob schedule describing blob limits.
///
/// Implementations can use this schedule to determine the maximum blobs allowed for blocks
/// in/after a given epoch, depending on the network’s planned parameter changes.
pub const BlobScheduleEntry = struct {
    EPOCH: u64,
    MAX_BLOBS_PER_BLOCK: u64,
};

/// An override type for `ChainConfig` where all fields are optional.
///
/// Intended for "partial configs" (e.g. CLI/env overrides). Any `null` field means "leave the
/// base config value unchanged".
pub const OptionalChainConfig = Optional(ChainConfig);

/// Merge `overrides` into `config`, returning a new `ChainConfig`.
///
/// For each field: if `overrides.<field>` is non-null, it replaces `config.<field>`.
/// Otherwise the original value is kept. Precedence is always given to `overrides`.
pub fn merge(config: *const ChainConfig, overrides: OptionalChainConfig) ChainConfig {
    var merged = config.*;
    inline for (std.meta.fields(@TypeOf(overrides))) |field| {
        if (@field(overrides, field.name)) |value| {
            @field(merged, field.name) = value;
        }
    }
    return merged;
}

/// Utility to create a struct type with all optional fields
fn Optional(comptime T: type) type {
    const type_info = @typeInfo(T);
    if (type_info != .@"struct") {
        @compileError("Optional can only be used with struct types");
    }
    const t_fields = type_info.@"struct".fields;
    var names: [t_fields.len][:0]const u8 = undefined;
    var types: [t_fields.len]type = undefined;
    var attrs: [t_fields.len]std.builtin.Type.StructField.Attributes = undefined;
    inline for (t_fields, 0..) |field, i| {
        const optional_type = ?field.type;
        names[i] = field.name;
        types[i] = optional_type;
        attrs[i] = .{
            .default_value_ptr = &@as(optional_type, null),
        };
    }

    return @Struct(.auto, null, &names, &types, &attrs);
}

test {
    _ = @import("chain_config_test.zig");
}
