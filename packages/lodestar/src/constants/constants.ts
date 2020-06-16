/**
 * @module constants
 */

export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32
export const GENESIS_SLOT = 0n;
export const GENESIS_EPOCH = 0n;
export const GENESIS_START_SHARD = 0;
export const FAR_FUTURE_EPOCH = 2n**64n - 1n;
export const ZERO_HASH = Buffer.alloc(32, 0);
export const EMPTY_SIGNATURE = Buffer.alloc(96, 0);

// Domain Types
export enum DomainType {
  BEACON_PROPOSER = 0,
  BEACON_ATTESTER = 1,
  RANDAO = 2,
  DEPOSIT = 3,
  VOLUNTARY_EXIT = 4,
  SELECTION_PROOF = 5,
  AGGREGATE_AND_PROOF = 6,
}
