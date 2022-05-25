import {PresetName} from "./presetName.js";
import {preset as mainnet} from "./presets/mainnet/index.js";
import {preset as minimal} from "./presets/minimal/index.js";
import {presetStatus} from "./presetStatus.js";
import {userSelectedPreset} from "./setPreset.js";

export * from "./interface/index.js";
export {ForkName} from "./forkName.js";
export {presetToJson} from "./json.js";
export {PresetName};

const presets = {
  [PresetName.mainnet]: mainnet,
  [PresetName.minimal]: minimal,
};

// Once this file is imported, freeze the preset so calling setActivePreset() will throw an error
presetStatus.frozen = true;

/**
 * The preset name currently exported by this library
 *
 * The `LODESTAR_PRESET` environment variable is used to select the active preset
 * If `LODESTAR_PRESET` is not set, the default is `mainnet`.
 *
 * The active preset can be manually overridden with `setActivePreset`
 */
export const ACTIVE_PRESET =
  userSelectedPreset || PresetName[process?.env?.LODESTAR_PRESET as PresetName] || PresetName.mainnet;
export const activePreset = presets[ACTIVE_PRESET];

// These variables must be exported individually and explicitly
// in order to be accessible as top-level exports
export const {
  MAX_COMMITTEES_PER_SLOT,
  TARGET_COMMITTEE_SIZE,
  MAX_VALIDATORS_PER_COMMITTEE,
  SHUFFLE_ROUND_COUNT,
  HYSTERESIS_QUOTIENT,
  HYSTERESIS_DOWNWARD_MULTIPLIER,
  HYSTERESIS_UPWARD_MULTIPLIER,
  SAFE_SLOTS_TO_UPDATE_JUSTIFIED,
  MIN_DEPOSIT_AMOUNT,
  MAX_EFFECTIVE_BALANCE,
  EFFECTIVE_BALANCE_INCREMENT,
  MIN_ATTESTATION_INCLUSION_DELAY,
  SLOTS_PER_EPOCH,
  MIN_SEED_LOOKAHEAD,
  MAX_SEED_LOOKAHEAD,
  EPOCHS_PER_ETH1_VOTING_PERIOD,
  SLOTS_PER_HISTORICAL_ROOT,
  MIN_EPOCHS_TO_INACTIVITY_PENALTY,
  EPOCHS_PER_HISTORICAL_VECTOR,
  EPOCHS_PER_SLASHINGS_VECTOR,
  HISTORICAL_ROOTS_LIMIT,
  VALIDATOR_REGISTRY_LIMIT,
  BASE_REWARD_FACTOR,
  WHISTLEBLOWER_REWARD_QUOTIENT,
  PROPOSER_REWARD_QUOTIENT,
  INACTIVITY_PENALTY_QUOTIENT,
  MIN_SLASHING_PENALTY_QUOTIENT,
  PROPORTIONAL_SLASHING_MULTIPLIER,
  MAX_PROPOSER_SLASHINGS,
  MAX_ATTESTER_SLASHINGS,
  MAX_ATTESTATIONS,
  MAX_DEPOSITS,
  MAX_VOLUNTARY_EXITS,

  SYNC_COMMITTEE_SIZE,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR,
  MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR,
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR,
  MIN_SYNC_COMMITTEE_PARTICIPANTS,
  UPDATE_TIMEOUT,

  INACTIVITY_PENALTY_QUOTIENT_BELLATRIX,
  MIN_SLASHING_PENALTY_QUOTIENT_BELLATRIX,
  PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX,
  MAX_BYTES_PER_TRANSACTION,
  MAX_TRANSACTIONS_PER_PAYLOAD,
  BYTES_PER_LOGS_BLOOM,
  MAX_EXTRA_DATA_BYTES,
} = presets[ACTIVE_PRESET];

////////////
// Constants
////////////

// Exported directly on the index for faster accessing without commonjs compiled star import shenanigans

// Misc

export const GENESIS_SLOT = 0;
export const GENESIS_EPOCH = 0;
export const FAR_FUTURE_EPOCH = Infinity;
export const BASE_REWARDS_PER_EPOCH = 4;
export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32
export const JUSTIFICATION_BITS_LENGTH = 4;

// Withdrawal prefixes

export const BLS_WITHDRAWAL_PREFIX = Uint8Array.from([0]);
export const ETH1_ADDRESS_WITHDRAWAL_PREFIX = Uint8Array.from([1]);

// Domain types

export const DOMAIN_BEACON_PROPOSER = Uint8Array.from([0, 0, 0, 0]);
export const DOMAIN_BEACON_ATTESTER = Uint8Array.from([1, 0, 0, 0]);
export const DOMAIN_RANDAO = Uint8Array.from([2, 0, 0, 0]);
export const DOMAIN_DEPOSIT = Uint8Array.from([3, 0, 0, 0]);
export const DOMAIN_VOLUNTARY_EXIT = Uint8Array.from([4, 0, 0, 0]);
export const DOMAIN_SELECTION_PROOF = Uint8Array.from([5, 0, 0, 0]);
export const DOMAIN_AGGREGATE_AND_PROOF = Uint8Array.from([6, 0, 0, 0]);
export const DOMAIN_SYNC_COMMITTEE = Uint8Array.from([7, 0, 0, 0]);
export const DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF = Uint8Array.from([8, 0, 0, 0]);
export const DOMAIN_CONTRIBUTION_AND_PROOF = Uint8Array.from([9, 0, 0, 0]);

// Participation flag indices

export const TIMELY_SOURCE_FLAG_INDEX = 0;
export const TIMELY_TARGET_FLAG_INDEX = 1;
export const TIMELY_HEAD_FLAG_INDEX = 2;

// Incentivization weights

export const TIMELY_SOURCE_WEIGHT = 14;
export const TIMELY_TARGET_WEIGHT = 26;
export const TIMELY_HEAD_WEIGHT = 14;
export const SYNC_REWARD_WEIGHT = 2;
export const PROPOSER_WEIGHT = 8;
export const WEIGHT_DENOMINATOR = 64;

// altair misc

export const PARTICIPATION_FLAG_WEIGHTS = [TIMELY_SOURCE_WEIGHT, TIMELY_TARGET_WEIGHT, TIMELY_HEAD_WEIGHT];

// phase0 validator

export const TARGET_AGGREGATORS_PER_COMMITTEE = 16;
export const RANDOM_SUBNETS_PER_VALIDATOR = 1;
export const EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION = 256;
/** Rationale: https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#why-are-there-attestation_subnet_count-attestation-subnets */
export const ATTESTATION_SUBNET_COUNT = 64;

// altair validator

export const TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE = 16;
export const SYNC_COMMITTEE_SUBNET_COUNT = 4;
export const SYNC_COMMITTEE_SUBNET_SIZE = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);

export const MAX_REQUEST_BLOCKS = 2 ** 10; // 1024

// Bellatrix constants - Spec v1.0.1
// Genesis testing settings
// Note: These configuration settings do not apply to the mainnet and are utilized only by pure Merge testing.
export const GENESIS_GAS_LIMIT = 30000000;
export const GENESIS_BASE_FEE_PER_GAS = BigInt(1000000000);

// Lightclient pre-computed
/**
 * ```ts
 * config.types.altair.BeaconState.getPathGindex(["finalizedCheckpoint", "root"])
 * ```
 */
export const FINALIZED_ROOT_GINDEX = 105;
/**
 * ```ts
 * Math.floor(Math.log2(FINALIZED_ROOT_GINDEX))
 * ```
 */
export const FINALIZED_ROOT_DEPTH = 6;
export const FINALIZED_ROOT_INDEX = 41;
/**
 * ```ts
 * config.types.altair.BeaconState.getPathGindex(["nextSyncCommittee"])
 * ```
 */
export const NEXT_SYNC_COMMITTEE_GINDEX = 55;
/**
 * ```ts
 * Math.floor(Math.log2(NEXT_SYNC_COMMITTEE_GINDEX))
 * ```
 */
export const NEXT_SYNC_COMMITTEE_DEPTH = 5;
export const NEXT_SYNC_COMMITTEE_INDEX = 23;

/**
 * Optimistic sync
 */
export const SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY = 128;
export const INTERVALS_PER_SLOT = 3;
