// Misc

export const GENESIS_SLOT = 0;
export const GENESIS_EPOCH = 0;
export const FAR_FUTURE_EPOCH = Infinity;
export const BASE_REWARDS_PER_EPOCH = 4;
export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32
export const JUSTIFICATION_BITS_LENGTH = 4;

// Withdrawal prefixes

export const BLS_WITHDRAWAL_PREFIX = Uint8Array.from([0]);
export const ETH1_ADDRESS_WITHDRAWAL_PREFIX = Uint8Array.from([0]);

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

export const TIMELY_SOURCE_WEIGHT = BigInt(14);
export const TIMELY_TARGET_WEIGHT = BigInt(26);
export const TIMELY_HEAD_WEIGHT = BigInt(14);
export const SYNC_REWARD_WEIGHT = BigInt(2);
export const PROPOSER_WEIGHT = BigInt(8);
export const WEIGHT_DENOMINATOR = BigInt(64);

// altair misc

export const PARTICIPATION_FLAG_WEIGHTS = [TIMELY_SOURCE_WEIGHT, TIMELY_TARGET_WEIGHT, TIMELY_HEAD_WEIGHT];

// phase0 validator

export const TARGET_AGGREGATORS_PER_COMMITTEE = 16;
export const RANDOM_SUBNETS_PER_VALIDATOR = 1;
export const EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION = 256;
/** Rationale: https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#why-are-there-attestation_subnet_count-attestation-subnets */
export const ATTESTATION_SUBNET_COUNT = 64;

// altair validator

export const TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE = 4;
export const SYNC_COMMITTEE_SUBNET_COUNT = 4;

export const MAX_REQUEST_BLOCKS = 2 ** 10; // 1024

//

export const MIN_SYNC_COMMITTEE_PARTICIPANTS = 1;

// Lightclient pre-computed
/**
 * ```ts
 * config.types.altair.BeaconState.getPathGindex(["finalizedCheckpoint", "root"])
 * ```
 */
export const FINALIZED_ROOT_INDEX = 105;
/**
 * ```ts
 * Math.floor(Math.log2(FINALIZED_ROOT_INDEX))
 * ```
 */
export const FINALIZED_ROOT_INDEX_FLOORLOG2 = 6;
/**
 * ```ts
 * config.types.altair.BeaconState.getPathGindex(["nextSyncCommittee"])
 * ```
 */
export const NEXT_SYNC_COMMITTEE_INDEX = 55;
/**
 * ```ts
 * Math.floor(Math.log2(NEXT_SYNC_COMMITTEE_INDEX))
 * ```
 */
export const NEXT_SYNC_COMMITTEE_INDEX_FLOORLOG2 = 5;
