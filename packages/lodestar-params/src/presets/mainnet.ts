/**
 * @module params/presets/mainnet
 */

// Misc
export const MAX_COMMITTEES_PER_SLOT = 2 ** 6; // 64 committees
export const TARGET_COMMITTEE_SIZE = 2 ** 7; // 128 validators
export const MAX_VALIDATORS_PER_COMMITTEE = 2 ** 11; // 2048
export const MIN_PER_EPOCH_CHURN_LIMIT = 2 ** 2; // 4
export const CHURN_LIMIT_QUOTIENT = 2 ** 16; // 65536
export const BASE_REWARDS_PER_EPOCH = 4;
export const SHUFFLE_ROUND_COUNT = 90;
export const MIN_GENESIS_ACTIVE_VALIDATOR_COUNT = 2 ** 14;
export const MIN_GENESIS_TIME = 1578009600;
export const TARGET_AGGREGATORS_PER_COMMITTEE = 16;
export const RANDOM_SUBNETS_PER_VALIDATOR = 1;
export const EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION = 256;


// Deposit contract
export const DEPOSIT_CONTRACT_ADDRESS = 0;
export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32

// Gwei Values
export const MIN_DEPOSIT_AMOUNT = BigInt(1000000000); // 1,000,000,000 Gwei
export const MAX_EFFECTIVE_BALANCE = BigInt(32000000000); // 32,000,000,000 Gwei
export const EJECTION_BALANCE = BigInt(16000000000); // 16,000,000,000 Gwei
export const EFFECTIVE_BALANCE_INCREMENT = BigInt(1000000000); // 1,000,000,000 Gwei

// Initial values
export const GENESIS_SLOT = 0;
export const SAFE_SLOTS_TO_UPDATE_JUSTIFIED = 8;
export const GENESIS_EPOCH = 0;
export const BLS_WITHDRAWAL_PREFIX_BYTE = Buffer.alloc(1, 0);
export const GENESIS_FORK_VERSION = Buffer.alloc(4, 0);
export const GENESIS_START_SHARD = 0;

// Time parameters
export const MIN_GENESIS_DELAY = 86400;
export const SECONDS_PER_SLOT = 12;
export const MIN_ATTESTATION_INCLUSION_DELAY = 1; // slots || 12 seconds
export const SLOTS_PER_EPOCH = 32; // slots || 6.4 minutes
export const MIN_SEED_LOOKAHEAD = 1; // epochs || 6.4 minutes
export const MAX_SEED_LOOKAHEAD = 4; // epochs || 25.6 minutes
export const SLOTS_PER_ETH1_VOTING_PERIOD = 1024; // slots || ~1.7 hours
export const ETH1_FOLLOW_DISTANCE = 1024; // blocks || ~4 hours
export const SLOTS_PER_HISTORICAL_ROOT = 8192; // slots || ~13 hours
export const MIN_VALIDATOR_WITHDRAWAL_DELAY = 256; // epochs || ~27 hours
export const PERSISTENT_COMMITTEE_PERIOD = 2048; // epochs || 9 days

export const MIN_EPOCHS_TO_INACTIVITY_PENALTY = 2 ** 2; // 25.6 minutes

// State list lengths
export const EPOCHS_PER_HISTORICAL_VECTOR = 2 ** 16;
export const EPOCHS_PER_SLASHINGS_VECTOR = 2 ** 13;
export const HISTORICAL_ROOTS_LIMIT = 2 ** 24;
export const VALIDATOR_REGISTRY_LIMIT = 1099511627776;

// Reward and penalty quotients
export const BASE_REWARD_FACTOR = 2 ** 6; // 32
export const WHISTLEBLOWING_REWARD_QUOTIENT = 2 ** 9; // 512
export const PROPOSER_REWARD_QUOTIENT = 2 ** 3; // 8
export const INACTIVITY_PENALTY_QUOTIENT = 2n ** 25n; // 33,554,432
export const MIN_SLASHING_PENALTY_QUOTIENT = 2 ** 5; // 32

// Max operations per block
export const MAX_PROPOSER_SLASHINGS = 2 ** 4; // 16
export const MAX_ATTESTER_SLASHINGS = 2 ** 0; // 1
export const MAX_ATTESTATIONS = 2 ** 7; // 128
export const MAX_DEPOSITS = 16; // 16
export const MAX_VOLUNTARY_EXITS = 2 ** 4; // 16
