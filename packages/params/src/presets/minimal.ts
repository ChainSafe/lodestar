import {BeaconPreset} from "../interface.js";

/* eslint-disable @typescript-eslint/naming-convention */
export const minimalPreset: BeaconPreset = {
  // Misc
  // ---------------------------------------------------------------
  // [customized] Just 4 committees for slot for testing purposes
  MAX_COMMITTEES_PER_SLOT: 4,
  // [customized] unsecure, but fast
  TARGET_COMMITTEE_SIZE: 4,
  // 2**11 (= 2,048)
  MAX_VALIDATORS_PER_COMMITTEE: 2048,
  // [customized] Faster, but unsecure.
  SHUFFLE_ROUND_COUNT: 10,
  // 4
  HYSTERESIS_QUOTIENT: 4,
  // 1 (minus 0.25)
  HYSTERESIS_DOWNWARD_MULTIPLIER: 1,
  // 5 (plus 1.25)
  HYSTERESIS_UPWARD_MULTIPLIER: 5,

  // Fork Choice
  // ---------------------------------------------------------------
  // 2**1 (= 1)
  SAFE_SLOTS_TO_UPDATE_JUSTIFIED: 2,

  // Gwei values
  // ---------------------------------------------------------------
  // 2**0 * 10**9 (= 1,000,000,000) Gwei
  MIN_DEPOSIT_AMOUNT: 1000000000,
  // 2**5 * 10**9 (= 32,000,000,000) Gwei
  MAX_EFFECTIVE_BALANCE: 32000000000,
  // 2**0 * 10**9 (= 1,000,000,000) Gwei
  EFFECTIVE_BALANCE_INCREMENT: 1000000000,

  // Time parameters
  // ---------------------------------------------------------------
  // 2**0 (= 1) slots 6 seconds
  MIN_ATTESTATION_INCLUSION_DELAY: 1,
  // [customized] fast epochs
  SLOTS_PER_EPOCH: 8,
  // 2**0 (= 1) epochs
  MIN_SEED_LOOKAHEAD: 1,
  // 2**2 (= 4) epochs
  MAX_SEED_LOOKAHEAD: 4,
  // [customized] higher frequency new deposits from eth1 for testing
  EPOCHS_PER_ETH1_VOTING_PERIOD: 4,
  // [customized] smaller state
  SLOTS_PER_HISTORICAL_ROOT: 64,
  /*
  // 2**8 (= 256) epochs
  MIN_VALIDATOR_WITHDRAWABILITY_DELAY: 256,
  // [customized] higher frequency of committee turnover and faster time to acceptable voluntary exit
  SHARD_COMMITTEE_PERIOD: 64,
  */
  // 2**2 (= 4) epochs
  MIN_EPOCHS_TO_INACTIVITY_PENALTY: 4,

  // State vector lengths
  // ---------------------------------------------------------------
  // [customized] smaller state
  EPOCHS_PER_HISTORICAL_VECTOR: 64,
  // [customized] smaller state
  EPOCHS_PER_SLASHINGS_VECTOR: 64,
  // 2**24 (= 16,777,216) historical roots
  HISTORICAL_ROOTS_LIMIT: 16777216,
  // 2**40 (= 1,099,511,627,776) validator spots
  VALIDATOR_REGISTRY_LIMIT: 1099511627776,

  // Reward and penalty quotients
  // ---------------------------------------------------------------
  // 2**6 (= 64)
  BASE_REWARD_FACTOR: 64,
  // 2**9 (= 512)
  WHISTLEBLOWER_REWARD_QUOTIENT: 512,
  // 2**3 (= 8)
  PROPOSER_REWARD_QUOTIENT: 8,
  // [customized] 2**25 (= 33,554,432)
  INACTIVITY_PENALTY_QUOTIENT: 33554432,
  // [customized] 2**6 (= 64)
  MIN_SLASHING_PENALTY_QUOTIENT: 64,
  // [customized] 2 (lower safety margin than Phase 0 genesis but different than mainnet config for testing)
  PROPORTIONAL_SLASHING_MULTIPLIER: 2,

  // Max operations per block
  // ---------------------------------------------------------------
  // 2**4 (= 16)
  MAX_PROPOSER_SLASHINGS: 16,
  // 2**1 (= 2)
  MAX_ATTESTER_SLASHINGS: 2,
  // 2**7 (= 128)
  MAX_ATTESTATIONS: 128,
  // 2**4 (= 16)
  MAX_DEPOSITS: 16,
  // 2**4 (= 16)
  MAX_VOLUNTARY_EXITS: 16,

  // ALTAIR
  /////////
  SYNC_COMMITTEE_SIZE: 32,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: 8,
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR: 50331648,
  MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR: 64,
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR: 2,
  MIN_SYNC_COMMITTEE_PARTICIPANTS: 1,
  UPDATE_TIMEOUT: 64,

  // BELLATRIX
  ////////////
  INACTIVITY_PENALTY_QUOTIENT_BELLATRIX: 16777216,
  MIN_SLASHING_PENALTY_QUOTIENT_BELLATRIX: 32,
  PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX: 3,
  MAX_BYTES_PER_TRANSACTION: 1073741824,
  MAX_TRANSACTIONS_PER_PAYLOAD: 1048576,
  BYTES_PER_LOGS_BLOOM: 256,
  MAX_EXTRA_DATA_BYTES: 32,

  // CAPELLA
  //////////
  MAX_BLS_TO_EXECUTION_CHANGES: 16,
  MAX_WITHDRAWALS_PER_PAYLOAD: 4,
  MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP: 16,

  // DENEB
  ///////////
  // https://github.com/ethereum/consensus-specs/blob/dev/presets/minimal/eip4844.yaml
  FIELD_ELEMENTS_PER_BLOB: 4,
  MAX_BLOBS_PER_BLOCK: 4,
};
