/* eslint-disable @typescript-eslint/naming-convention */
import {PresetName} from "@chainsafe/lodestar-params";

/**
 * Run-time chain configuration
 */
export interface IChainConfig {
  PRESET_BASE: PresetName;

  // Transition
  TERMINAL_TOTAL_DIFFICULTY: bigint;
  TERMINAL_BLOCK_HASH: Uint8Array;

  // Genesis
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: number;
  MIN_GENESIS_TIME: number;
  GENESIS_FORK_VERSION: Uint8Array;
  GENESIS_DELAY: number;

  // Forking
  // Altair
  ALTAIR_FORK_VERSION: Uint8Array;
  ALTAIR_FORK_EPOCH: number;
  // Merge
  MERGE_FORK_VERSION: Uint8Array;
  MERGE_FORK_EPOCH: number;
  // Sharding
  SHARDING_FORK_VERSION: Uint8Array;
  SHARDING_FORK_EPOCH: number;

  // Time parameters
  SECONDS_PER_SLOT: number;
  SECONDS_PER_ETH1_BLOCK: number;
  MIN_VALIDATOR_WITHDRAWABILITY_DELAY: number;
  SHARD_COMMITTEE_PERIOD: number;
  ETH1_FOLLOW_DISTANCE: number;

  // Validator cycle
  INACTIVITY_SCORE_BIAS: number;
  INACTIVITY_SCORE_RECOVERY_RATE: number;
  EJECTION_BALANCE: number;
  MIN_PER_EPOCH_CHURN_LIMIT: number;
  CHURN_LIMIT_QUOTIENT: number;

  // Deposit contract
  DEPOSIT_CHAIN_ID: number;
  DEPOSIT_NETWORK_ID: number;
  DEPOSIT_CONTRACT_ADDRESS: Uint8Array;
}
