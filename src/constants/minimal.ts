/**
 * @module constants
 */

// Misc
export const SHARD_COUNT = 8; // CUSTOMIZED
export const TARGET_COMMITTEE_SIZE = 4; // CUSTOMIZED
export const MAX_INDICES_PER_ATTESTATION = 2 ** 12; // 4096
export const MIN_PER_EPOCH_CHURN_LIMIT = 2 ** 2; // 4
export const CHURN_LIMIT_QUOTIENT = 2 ** 16; // 65536
export const BASE_REWARDS_PER_EPOCH = 5;
export const SHUFFLE_ROUND_COUNT = 10; // CUSTOMIZED

// Deposit contract
export const DEPOSIT_CONTRACT_ADDRESS = "TBD";
export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32

// Gwei Values
export const MIN_DEPOSIT_AMOUNT = 2 ** 0 * 1e9; // 1,000,000,000 Gwei
export const MAX_EFFECTIVE_BALANCE = 2 ** 5 * 1e9; // 32,000,000,000 Gwei
export const EJECTION_BALANCE = 2 ** 4 * 1e9; // 16,000,000,000 Gwei
export const EFFECTIVE_BALANCE_INCREMENT = 2 ** 0 * 1e9; // 1,000,000,000 Gwei

// Initial values
export const GENESIS_SLOT = 0;
export const GENESIS_EPOCH = 0;
export const FAR_FUTURE_EPOCH = Infinity;
export const ZERO_HASH = Buffer.alloc(32);
export const BLS_WITHDRAWAL_PREFIX_BYTE = Buffer.alloc(1);
export const EMPTY_SIGNATURE = Buffer.alloc(96);
export const GENESIS_FORK_VERSION = Buffer.alloc(4);
export const GENESIS_START_SHARD = 0;

// Time parameters
export const SECONDS_PER_SLOT = 6;
export const MIN_ATTESTATION_INCLUSION_DELAY = 2; // CUSTOMIZED
export const SLOTS_PER_EPOCH = 8; // CUSTOMIZED
export const MIN_SEED_LOOKAHEAD = 2 ** 0; // epochs || 6.4 minutes
export const ACTIVATION_EXIT_DELAY = 2 ** 2; // epochs || 25.6 minutes
export const SLOTS_PER_ETH1_VOTING_PERIOD = 16; // CUSTOMIZED
export const SLOTS_PER_HISTORICAL_ROOT = 64; // CUSTOMIZED
export const MIN_VALIDATOR_WITHDRAWAL_DELAY = 2 ** 8; // epochs || ~27 hours
export const PERSISTENT_COMMITTEE_PERIOD = 2 ** 11; // epochs || 9 days
// should be a small constant times SHARD_COUNT // SLOTS_PER_EPOCH
export const MAX_CROSSLINK_EPOCHS = 2 ** 6; // 64
export const MIN_EPOCHS_TO_INACTIVITY_PENALTY = 2 ** 2; // 25.6 minutes

// State list lengths
export const LATEST_RANDAO_MIXES_LENGTH = 64; // CUSTOMIZED
export const LATEST_ACTIVE_INDEX_ROOTS_LENGTH = 64; // CUSTOMIZED
export const LATEST_SLASHED_EXIT_LENGTH = 64; // CUSTOMIZED

// Reward and penalty quotients
export const BASE_REWARD_QUOTIENT = 2 ** 5; // 32
export const WHISTLEBLOWING_REWARD_QUOTIENT = 2 ** 9; // 512
export const PROPOSER_REWARD_QUOTIENT = 2 ** 3; // 8
export const INACTIVITY_PENALTY_QUOTIENT = 2 ** 25; // 33,554,432
export const MIN_SLASHING_PENALTY_QUOTIENT = 2 ** 5; // 32

// Max operations per block
export const MAX_PROPOSER_SLASHINGS = 2 ** 4; // 16
export const MAX_ATTESTER_SLASHINGS = 2 ** 0; // 1
export const MAX_ATTESTATIONS = 2 ** 7; // 128
export const MAX_DEPOSITS = 2 ** 4; // 16
export const MAX_VOLUNTARY_EXITS = 2 ** 4; // 16
export const MAX_TRANSFERS = 0;

// Signature domains
export enum Domain {
  BEACON_PROPOSER = 0,
  RANDAO = 1,
  ATTESTATION = 2,
  DEPOSIT = 3,
  VOLUNTARY_EXIT = 4,
  TRANSFER = 5,
}
