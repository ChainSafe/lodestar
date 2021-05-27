/* eslint-disable @typescript-eslint/naming-convention */
import {ForkName, PresetName} from "@chainsafe/lodestar-params";
import {allForks, Epoch, Slot, Version} from "@chainsafe/lodestar-types";

export interface IChainConfig {
  PRESET_BASE: PresetName;

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

  TRANSITION_TOTAL_DIFFICULTY: number;

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

export interface IForkInfo {
  name: ForkName;
  epoch: Epoch;
  version: Version;
}

export interface IForkConfig {
  /** Forks in order order of occurence, `phase0` first */
  forks: {[K in ForkName]: IForkInfo};
  /** Get the hard-fork info for the active fork at `slot` */
  getForkInfo(slot: Slot): IForkInfo;

  /** Get the hard-fork name at a given slot */
  getForkName(slot: Slot): ForkName;
  /** Get the hard-fork version at a given slot */
  getForkVersion(slot: Slot): Version;
  /** Get SSZ types by hard-fork */
  getForkTypes(slot: Slot): allForks.AllForksSSZTypes;
}

export type IBeaconConfig = IChainConfig & IForkConfig;
