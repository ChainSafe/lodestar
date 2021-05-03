export const GENESIS_SLOT = 0;
export const GENESIS_EPOCH = 0;
export const FAR_FUTURE_EPOCH = Infinity;
export const BASE_REWARDS_PER_EPOCH = 4;
export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32
export const JUSTIFICATION_BITS_LENGTH = 4;
export const ATTESTATION_SUBNET_COUNT = 64;
export const MAX_REQUEST_BLOCKS = 2 ** 10; // 1024
export const P2P_ERROR_MESSAGE_MAX_LENGTH = 256;

export const MIN_SYNC_COMMITTEE_PARTICIPANTS = 1;
//~27 hours
export const LIGHT_CLIENT_UPDATE_TIMEOUT = 2 ** 13;

// Lightclient pre-computed
/**
 * ```ts
 * BigInt(2 ** 64) - BigInt(1);
 * ```
 * But approximated to `Number.MAX_SAFE_INTEGER`
 */
export const MAX_VALID_LIGHT_CLIENT_UPDATES = Number.MAX_SAFE_INTEGER;
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
