/**
 * @module constants
 */

export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32
export const GENESIS_SLOT = 0;
export const GENESIS_EPOCH = 0;
export const FAR_FUTURE_EPOCH = Infinity;
export const ZERO_HASH = Buffer.alloc(32, 0);
export const EMPTY_SIGNATURE = Buffer.alloc(96, 0);
export const SECONDS_PER_DAY = 86400;
export const BASE_REWARDS_PER_EPOCH = 4;
