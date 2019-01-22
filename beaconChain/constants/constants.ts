// https://github.com/ethereum/eth2.0-specs/blob/master/specs/core/0_beacon-chain.md#constants

// Misc
export const SHARD_COUNT = 2 ** 10; // 1024 shards
export const TARGET_COMMITTEE_SIZE = 2 ** 8; // 256 validators
export const EJECTION_BALANCE = 2 ** 4; // 16 ETH
export const MAX_BALANCE_CHURN_QUOTIENT = 2 ** 5; // 32
export const GWEI_PER_ETH = 10 ** 9; // 1B Gwei/ETH
export const BEACON_CHAIN_SHARD_NUMBER = 2 ** 64 - 1;
export const MAX_CASPER_VOTES = 2 ** 10; // 1024 votes
export const LATEST_BLOCK_ROOTS_LENGTH =  2 ** 13; // 8192 block roots
export const LATEST_RANDAO_MIXES_LENGTH = 2 ** 13; // 8192 randao mixes
export const LATEST_PENALIZED_EXIT_LENGTH = 2 ** 13; // 8192 epochs
export const MAX_WITHDRAWALS_PER_EPOCH = 2 ** 2; // 4 withdrawals

// Deposit contract
export const DEPOSIT_CONTRACT_ADDRESS = "TBD";
export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32
export const MIN_DEPOSIT = 2 ** 0; // 1 ETH
export const MAX_DEPOSIT = 2 ** 5; // 32 ETH

// Initial values
export const GENESIS_FORK_VERSION	= 0;
export const GENESIS_SLOT = 0;
export const GENESIS_START_SHARD = 0;
export const FAR_FUTURE_SLOT = 2 ** 64 - 1;
export const ZERO_HASH = new Uint8Array(32);
export const EMPTY_SIGNATURE = [new Uint8Array(48), new Uint8Array(48)]; // [bytes48(0), bytes48(0)]
export const BLS_WITHDRAWAL_PREFIX_BYTE = new Uint8Array(1);

// Time parameters
export const SLOT_DURATION = 6; // 6 seconds
export const MIN_ATTESTATION_INCLUSION_DELAY = 2 ** 2; // 4 slots
export const EPOCH_LENGTH = 2 ** 6; // 64 slots
export const SEED_LOOKAHEAD = 2 ** 6; // 64 slots
export const ENTRY_EXIT_DELAY = 2 ** 8; // 256 slots
export const DEPOSIT_ROOT_VOTING_PERIOD = 2 ** 10; // 1024 slots
export const MIN_VALIDATOR_WITHDRAWAL_TIME = 2 ** 14; // 16,384 slots

// Reward and penalty quotients
export const BASE_REWARD_QUOTIENT = 2 ** 10; // 1024
export const WHISTLEBLOWER_REWARD_QUOTIENT = 2 ** 9; // 512
export const INCLUDER_REWARD_QUOTIENT = 2 ** 3; // 8
export const INACTIVITY_PENALTY_QUOTIENT = 2 ** 24; // 16,777,216

// Max operations per block
export const MAX_PROPOSER_SLASHINGS = 2 ** 4; // 16
export const MAX_CASPER_SLASHINGS = 2 ** 4; // 16
export const MAX_ATTESTATIONS = 2 ** 7; // 128
export const MAX_DEPOSITS = 2 ** 4; // 16
export const MAX_EXITS = 2 ** 4; // 16

// OLD
// export const MIN_VALIDATOR_REGISTRY_CHANGE_INTERVAL = 2 ** 8; // 256 slots
// export const POW_RECEIPT_ROOT_VOTING_PERIOD = 2 ** 10; // 1024 slots
// export const SHARD_PERSISTENT_COMMITTEE_CHANGE_POERIOD = 2 ** 17; // 131,072 slots
// export const COLLECTIVE_PENALTY_CALCULATION_PERIOD = 2 ** 20; // 1,048,576 slots
// export const ZERO_BALANCE_VALIDATOR_TTL = 2 ** 22; // 4,194,304 slots
