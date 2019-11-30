/**
 * @module params/presets/minimal
 */

import BN from "bn.js";

// Misc
export const MAX_COMMITTEES_PER_SLOT = 4; // Just 4 committees for slot for testing purposes
export const TARGET_COMMITTEE_SIZE = 4; // CUSTOMIZED
export const MAX_VALIDATORS_PER_COMMITTEE = 2048; // 2048
export const MIN_PER_EPOCH_CHURN_LIMIT = 2 ** 2; // 4
export const CHURN_LIMIT_QUOTIENT = 65536; // 65536
export const BASE_REWARDS_PER_EPOCH = 4;
export const SHUFFLE_ROUND_COUNT = 10; // CUSTOMIZED
export const MIN_GENESIS_TIME = 1578009600;
export const MIN_GENESIS_ACTIVE_VALIDATOR_COUNT = 64;

// Deposit contract
export const DEPOSIT_CONTRACT_ADDRESS = 0;
export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32

// Gwei Values
export const MIN_DEPOSIT_AMOUNT = new BN("1000000000"); // 1,000,000,000 Gwei
export const MAX_EFFECTIVE_BALANCE = new BN("32000000000"); // 32,000,000,000 Gwei
export const EJECTION_BALANCE = new BN("16000000000"); // 16,000,000,000 Gwei
export const EFFECTIVE_BALANCE_INCREMENT = new BN("1000000000"); // 1,000,000,000 Gwei

// Initial values
export const GENESIS_SLOT = 0;
export const SAFE_SLOTS_TO_UPDATE_JUSTIFIED = 8;
export const GENESIS_EPOCH = 0;
export const BLS_WITHDRAWAL_PREFIX_BYTE = Buffer.alloc(1);
export const GENESIS_FORK_VERSION = Buffer.alloc(4);
export const GENESIS_START_SHARD = 0;

// Time parameters
export const SECONDS_PER_SLOT = 12;
export const MIN_ATTESTATION_INCLUSION_DELAY = 1; // CUSTOMIZED
export const SLOTS_PER_EPOCH = 8; // CUSTOMIZED
export const MIN_SEED_LOOKAHEAD = 2 ** 0; // epochs || 6.4 minutes
export const MAX_SEED_LOOKAHEAD = 2 ** 2; // epochs || 25.6 minutes
export const SLOTS_PER_ETH1_VOTING_PERIOD = 16; // CUSTOMIZED
export const ETH1_FOLLOW_DISTANCE = 2 ** 10; // blocks || ~4 hours
export const SLOTS_PER_HISTORICAL_ROOT = 64; // CUSTOMIZED
export const MIN_VALIDATOR_WITHDRAWAL_DELAY = 256; // epochs || ~27 hours
export const PERSISTENT_COMMITTEE_PERIOD = 2048;

export const MIN_EPOCHS_TO_INACTIVITY_PENALTY = 4;

// State list lengths
export const EPOCHS_PER_HISTORICAL_VECTOR = 64;
export const EPOCHS_PER_SLASHINGS_VECTOR = 64;
export const HISTORICAL_ROOTS_LIMIT = 16777216;
export const VALIDATOR_REGISTRY_LIMIT = 1099511627776;

// Reward and penalty quotients
export const BASE_REWARD_FACTOR = 64;
export const WHISTLEBLOWING_REWARD_QUOTIENT = 512; // 512
export const PROPOSER_REWARD_QUOTIENT = 8; // 8
export const INACTIVITY_PENALTY_QUOTIENT = new BN(2 ** 25); // 33,554,432
export const MIN_SLASHING_PENALTY_QUOTIENT = 32; // 3EPOCHS_PER_SLASHINGS_VECTOR2

// Max operations per block
export const MAX_PROPOSER_SLASHINGS = 2 ** 4; // 16
export const MAX_ATTESTER_SLASHINGS = 2 ** 0; // 1
export const MAX_ATTESTATIONS = 2 ** 7; // 128
export const MAX_DEPOSITS = 2 ** 4; // 16
export const MAX_VOLUNTARY_EXITS = 2 ** 4; // 16
