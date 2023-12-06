/**
 * A simple data structure to store rewards payable to block proposer in the memory.
 * Rewards are updated throughout the state transition
 * Should only hold info for one state transition
 */
export type RewardCache = {
  attestations: number;
  syncAggregate: number;
  slashing: number; // Sum of attester and proposer slashing reward
};

export function createRewardCache(): RewardCache {
  return {
    attestations: 0,
    syncAggregate: 0,
    slashing: 0,
  };
}
