/**
 * @module params
 */

export interface IBeaconParams {
  // Misc
  MAX_COMMITTEES_PER_SLOT: number;
  TARGET_COMMITTEE_SIZE: number;
  MAX_VALIDATORS_PER_COMMITTEE: number;
  MIN_PER_EPOCH_CHURN_LIMIT: number;
  CHURN_LIMIT_QUOTIENT: number;
  SHUFFLE_ROUND_COUNT: number;
  MIN_GENESIS_TIME: number;
  HYSTERESIS_QUOTIENT: number;
  HYSTERESIS_DOWNWARD_MULTIPLIER: number;
  HYSTERESIS_UPWARD_MULTIPLIER: number;
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: number;
  TARGET_AGGREGATORS_PER_COMMITTEE: number;
  RANDOM_SUBNETS_PER_VALIDATOR: number;
  EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION: number;
  SECONDS_PER_ETH1_BLOCK: number;

  // Deposit contract
  DEPOSIT_CONTRACT_ADDRESS: number;

  // Gwei Values
  MIN_DEPOSIT_AMOUNT: bigint;
  MAX_EFFECTIVE_BALANCE: bigint;
  EJECTION_BALANCE: bigint;
  EFFECTIVE_BALANCE_INCREMENT: bigint;

  // Initial values
  SAFE_SLOTS_TO_UPDATE_JUSTIFIED: number;
  BLS_WITHDRAWAL_PREFIX: Buffer;
  GENESIS_FORK_VERSION: Buffer;
  GENESIS_START_SHARD: number;

  // Time parameters
  MIN_GENESIS_DELAY: number;
  SECONDS_PER_SLOT: number;
  MIN_ATTESTATION_INCLUSION_DELAY: bigint;
  SLOTS_PER_EPOCH: bigint;
  MIN_SEED_LOOKAHEAD: bigint;
  MAX_SEED_LOOKAHEAD: bigint;
  EPOCHS_PER_ETH1_VOTING_PERIOD: bigint;
  ETH1_FOLLOW_DISTANCE: number;
  SLOTS_PER_HISTORICAL_ROOT: bigint;
  MIN_VALIDATOR_WITHDRAWABILITY_DELAY: bigint;
  PERSISTENT_COMMITTEE_PERIOD: bigint;

  MIN_EPOCHS_TO_INACTIVITY_PENALTY: bigint;

  // State list lengths
  EPOCHS_PER_HISTORICAL_VECTOR: bigint;
  EPOCHS_PER_SLASHINGS_VECTOR: bigint;
  HISTORICAL_ROOTS_LIMIT: number;
  VALIDATOR_REGISTRY_LIMIT: number;

  // Reward and penalty quotients
  BASE_REWARD_FACTOR: number;
  BASE_REWARDS_PER_EPOCH: number;
  WHISTLEBLOWER_REWARD_QUOTIENT: number;
  PROPOSER_REWARD_QUOTIENT: number;
  INACTIVITY_PENALTY_QUOTIENT: bigint;
  MIN_SLASHING_PENALTY_QUOTIENT: number;

  // Max operations per block
  MAX_PROPOSER_SLASHINGS: number;
  MAX_ATTESTER_SLASHINGS: number;
  MAX_ATTESTATIONS: number;
  MAX_DEPOSITS: number;
  MAX_VOLUNTARY_EXITS: number;

  // Old and future forks
  ALL_FORKS: IFork[];
}

interface IFork {
  // 4 bytes
  previousVersion: number;
  // 4 bytes
  currentVersion: number;
  // Fork epoch number
  epoch: bigint;
}

