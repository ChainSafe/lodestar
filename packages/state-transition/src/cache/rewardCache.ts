/**
 * A simple data structure to store rewards payable to block proposer in the memory.
 * Rewards are updated throughout the state transition
 * Should only hold info for one state transition
 * All values are in Gwei
 */
export type RewardCache = {
  attestations: number;
  syncAggregate: number;
  slashing: number; // Sum of attester and proposer slashing reward
};

export function createEmptyRewardCache(): RewardCache {
  return {
    attestations: 0,
    syncAggregate: 0,
    slashing: 0,
  };
}
