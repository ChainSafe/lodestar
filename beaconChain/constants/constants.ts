import BN from "bn.js";

// Misc
export const SHARD_COUNT = 2 ** 10; // 1024 shards
export const TARGET_COMMITTEE_SIZE = 2 ** 7; // 128 validators
export const EJECTION_BALANCE = 2 ** 4 * 1e9; // 16,000,000,000 Gwei
export const MAX_BALANCE_CHURN_QUOTIENT = 2 ** 5; // 32
export const BEACON_CHAIN_SHARD_NUMBER = 2 ** 64 - 1;
export const MAX_INDICES_PER_SLASHABLE_VOTE = 2 ** 12; // 4096
export const MAX_WITHDRAWALS_PER_EPOCH = 2 ** 2; // 4 withdrawals

// Deposit contract
export const DEPOSIT_CONTRACT_ADDRESS = "TBD";
export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32
export const MIN_DEPOSIT_AMOUNT = 2 ** 0 * 1e9; // 1,000,000,000 Gwei
export const MAX_DEPOSIT_AMOUNT = 2 ** 5 * 1e9; // 32,000,000,000 Gwei

// Time parameters
export const SLOT_DURATION = 6; // seconds || 6 seconds
export const MIN_ATTESTATION_INCLUSION_DELAY = 2 ** 2; // slots || 24 seconds
export const EPOCH_LENGTH = 2 ** 6; // slots || 6.4 minutes
export const SEED_LOOKAHEAD = 2 ** 0; // epochs || 6.4 minutes
export const ENTRY_EXIT_DELAY = 2 ** 2; // epochs || 25.6 minutes
export const DEPOSIT_ROOT_VOTING_PERIOD = 2 ** 4; // epochs || ~1.7 hours
export const MIN_VALIDATOR_WITHDRAWAL_TIME = 2 ** 8; // epochs || ~27 hours

// Initial values
export const GENESIS_FORK_VERSION	= new BN(0);
export const GENESIS_SLOT = new BN(2 ** 19);
export const GENESIS_EPOCH = GENESIS_SLOT.div(GENESIS_SLOT);
export const GENESIS_START_SHARD = new BN(0);
export const FAR_FUTURE_EPOCH = 2 ** 64 - 1;
export const ZERO_HASH = new Uint8Array(32);
export const EMPTY_SIGNATURE = new Uint8Array(96);
export const BLS_WITHDRAWAL_PREFIX_BYTE = new Uint8Array(1);

// State list lengths
export const LATEST_BLOCK_ROOTS_LENGTH =  2 ** 13; // epochs || ~13 hours
export const LATEST_RANDAO_MIXES_LENGTH = 2 ** 13; // epochs || ~36 days
export const LATEST_INDEX_ROOTS_LENGTH = 2 ** 13; // epochs || ~36 days
export const LATEST_PENALIZED_EXIT_LENGTH = 2 ** 13; // epochs || ~36 days

// Reward and penalty quotients
export const BASE_REWARD_QUOTIENT = 2 ** 5; // 32
export const WHISTLEBLOWER_REWARD_QUOTIENT = 2 ** 9; // 512
export const INCLUDER_REWARD_QUOTIENT = 2 ** 3; // 8
export const INACTIVITY_PENALTY_QUOTIENT = 2 ** 24; // 16,777,216

// Max operations per block
export const MAX_PROPOSER_SLASHINGS = 2 ** 4; // 16
export const MAX_ATTESTER_SLASHINGS = 2 ** 0; // 1
export const MAX_ATTESTATIONS = 2 ** 7; // 128
export const MAX_DEPOSITS = 2 ** 4; // 16
export const MAX_EXITS = 2 ** 4; // 16
