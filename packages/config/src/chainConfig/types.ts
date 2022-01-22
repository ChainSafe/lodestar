import {PresetName} from "@chainsafe/lodestar-params";

/* eslint-disable @typescript-eslint/naming-convention */

/**
 * Run-time chain configuration
 */
export type IChainConfig = {
  PRESET_BASE: PresetName;

  // Transition
  TERMINAL_TOTAL_DIFFICULTY: bigint;
  TERMINAL_BLOCK_HASH: Uint8Array;
  TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH: number;

  // Genesis
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: number;
  MIN_GENESIS_TIME: number;
  GENESIS_FORK_VERSION: Uint8Array;
  GENESIS_DELAY: number;

  // Forking
  // Altair
  ALTAIR_FORK_VERSION: Uint8Array;
  ALTAIR_FORK_EPOCH: number;
  // Bellatrix
  BELLATRIX_FORK_VERSION: Uint8Array;
  BELLATRIX_FORK_EPOCH: number;
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

  // Proposer boost
  PROPOSER_SCORE_BOOST: number;

  // Deposit contract
  DEPOSIT_CHAIN_ID: number;
  DEPOSIT_NETWORK_ID: number;
  DEPOSIT_CONTRACT_ADDRESS: Uint8Array;
};

export const chainConfigTypes: SpecTypes<IChainConfig> = {
  PRESET_BASE: "string",

  // Transition
  TERMINAL_TOTAL_DIFFICULTY: "bigint",
  TERMINAL_BLOCK_HASH: "bytes",
  TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH: "number",

  // Genesis
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: "number",
  MIN_GENESIS_TIME: "number",
  GENESIS_FORK_VERSION: "bytes",
  GENESIS_DELAY: "number",

  // Forking
  // Altair
  ALTAIR_FORK_VERSION: "bytes",
  ALTAIR_FORK_EPOCH: "number",
  // Bellatrix
  BELLATRIX_FORK_VERSION: "bytes",
  BELLATRIX_FORK_EPOCH: "number",
  // Sharding
  SHARDING_FORK_VERSION: "bytes",
  SHARDING_FORK_EPOCH: "number",

  // Time parameters
  SECONDS_PER_SLOT: "number",
  SECONDS_PER_ETH1_BLOCK: "number",
  MIN_VALIDATOR_WITHDRAWABILITY_DELAY: "number",
  SHARD_COMMITTEE_PERIOD: "number",
  ETH1_FOLLOW_DISTANCE: "number",

  // Validator cycle
  INACTIVITY_SCORE_BIAS: "number",
  INACTIVITY_SCORE_RECOVERY_RATE: "number",
  EJECTION_BALANCE: "number",
  MIN_PER_EPOCH_CHURN_LIMIT: "number",
  CHURN_LIMIT_QUOTIENT: "number",

  // Proposer boost
  PROPOSER_SCORE_BOOST: "number",

  // Deposit contract
  DEPOSIT_CHAIN_ID: "number",
  DEPOSIT_NETWORK_ID: "number",
  DEPOSIT_CONTRACT_ADDRESS: "bytes",
};

/** Allows values in a Spec file */
export type SpecValue = number | bigint | Uint8Array | string;

/** Type value name of each spec field. Numbers are ignored since they are the most common */
export type SpecValueType<V extends SpecValue> = V extends number
  ? "number"
  : V extends bigint
  ? "bigint"
  : V extends Uint8Array
  ? "bytes"
  : V extends string
  ? "string"
  : never;

/** All possible type names for a SpecValue */
export type SpecValueTypeName = SpecValueType<SpecValue>;

export type SpecTypes<Spec extends Record<string, SpecValue>> = {
  [K in keyof Spec]: SpecValueType<Spec[K]>;
};
