export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32
export const GENESIS_SLOT = 0;
export const GENESIS_EPOCH = 0;
export const GENESIS_START_SHARD = 0;
export const FAR_FUTURE_EPOCH = Infinity;
export const ZERO_HASH = Buffer.alloc(32, 0);
export const ZERO_HASH_HEX = "0x" + "00".repeat(32);
export const EMPTY_SIGNATURE = Buffer.alloc(96, 0);
export const GRAFFITI_SIZE = 32;

/**
 * The maximum milliseconds of clock disparity assumed between honest nodes.
 */
export const MAXIMUM_GOSSIP_CLOCK_DISPARITY = 500;
export const MAXIMUM_GOSSIP_CLOCK_DISPARITY_SEC = MAXIMUM_GOSSIP_CLOCK_DISPARITY / 1000;
