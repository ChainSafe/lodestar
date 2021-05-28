export const GENESIS_SLOT = 0;
export const GENESIS_EPOCH = 0;
export const FAR_FUTURE_EPOCH = Infinity;
export const BASE_REWARDS_PER_EPOCH = 4;
export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32
export const JUSTIFICATION_BITS_LENGTH = 4;
export const MAX_REQUEST_BLOCKS = 2 ** 10; // 1024

/** Rationale: https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#why-are-there-attestation_subnet_count-attestation-subnets */
export const ATTESTATION_SUBNET_COUNT = 64;

// https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/validator.md
export const SYNC_COMMITTEE_SUBNET_COUNT = 4;

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
