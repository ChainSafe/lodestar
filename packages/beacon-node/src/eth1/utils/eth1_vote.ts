import {EPOCHS_PER_ETH1_VOTING_PERIOD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";
import {phase0, RootHex} from "@lodestar/types";
import {BeaconStateAllForks, computeTimeAtSlot} from "@lodestar/state-transition";
import {toHex} from "@lodestar/utils";

export type Eth1DataGetter = ({
  timestampRange,
}: {
  timestampRange: {gte: number; lte: number};
}) => Promise<phase0.Eth1Data[]>;

export async function getEth1VotesToConsider(
  config: ChainForkConfig,
  state: BeaconStateAllForks,
  eth1DataGetter: Eth1DataGetter
): Promise<phase0.Eth1Data[]> {
  const periodStart = votingPeriodStartTime(config, state);
  const {SECONDS_PER_ETH1_BLOCK, ETH1_FOLLOW_DISTANCE} = config;

  // Modified version of the spec function to fetch the required range directly from the DB
  return (
    await eth1DataGetter({
      timestampRange: {
        // Spec v0.12.2
        // is_candidate_block =
        //   block.timestamp + SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE <= period_start &&
        //   block.timestamp + SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE * 2 >= period_start
        lte: periodStart - SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE,
        gte: periodStart - SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE * 2,
      },
    })
  ).filter((eth1Data) => eth1Data.depositCount >= state.eth1Data.depositCount);
}

export function pickEth1Vote(state: BeaconStateAllForks, votesToConsider: phase0.Eth1Data[]): phase0.Eth1Data {
  const votesToConsiderKeys = new Set<string>();
  for (const eth1Data of votesToConsider) {
    votesToConsiderKeys.add(getEth1DataKey(eth1Data));
  }

  const eth1DataHashToEth1Data = new Map<RootHex, phase0.Eth1Data>();
  const eth1DataVoteCountByRoot = new Map<RootHex, number>();
  const eth1DataVotesOrder: RootHex[] = [];

  // BeaconStateAllForks is always represented as a tree with a hashing cache.
  // To check equality its cheaper to use hashTreeRoot as keys.
  // However `votesToConsider` is an array of values since those are read from DB.
  // TODO: Optimize cache of known votes, to prevent re-hashing stored values.
  // Note: for low validator counts it's not very important, since this runs once per proposal
  const eth1DataVotes = state.eth1DataVotes.getAllReadonly();
  for (const eth1DataVote of eth1DataVotes) {
    const rootHex = getEth1DataKey(eth1DataVote);

    if (votesToConsiderKeys.has(rootHex)) {
      const prevVoteCount = eth1DataVoteCountByRoot.get(rootHex);
      eth1DataVoteCountByRoot.set(rootHex, 1 + (prevVoteCount ?? 0));

      // Cache eth1DataVote to root Map only once per root
      if (prevVoteCount === undefined) {
        eth1DataHashToEth1Data.set(rootHex, eth1DataVote);
        eth1DataVotesOrder.push(rootHex);
      }
    }
  }

  const eth1DataRootsMaxVotes = getKeysWithMaxValue(eth1DataVoteCountByRoot);

  // No votes, vote for the last valid vote
  if (eth1DataRootsMaxVotes.length === 0) {
    return votesToConsider[votesToConsider.length - 1] ?? state.eth1Data;
  }

  // If there's a single winning vote with a majority vote that one
  else if (eth1DataRootsMaxVotes.length === 1) {
    return eth1DataHashToEth1Data.get(eth1DataRootsMaxVotes[0]) ?? state.eth1Data;
  }

  // If there are multiple winning votes, vote for the latest one
  else {
    const latestMostVotedRoot =
      eth1DataVotesOrder[Math.max(...eth1DataRootsMaxVotes.map((root) => eth1DataVotesOrder.indexOf(root)))];
    eth1DataHashToEth1Data;
    return eth1DataHashToEth1Data.get(latestMostVotedRoot) ?? state.eth1Data;
  }
}

/**
 * Returns the array of keys with max value. May return 0, 1 or more keys
 */
function getKeysWithMaxValue<T>(map: Map<T, number>): T[] {
  const entries = Array.from(map.entries());
  let keysMax: T[] = [];
  let valueMax = -Infinity;

  for (const [key, value] of entries) {
    if (value > valueMax) {
      keysMax = [key];
      valueMax = value;
    } else if (value === valueMax) {
      keysMax.push(key);
    }
  }

  return keysMax;
}

/**
 * Key-ed by fastSerializeEth1Data(). votesToConsider is read from DB as struct and always has a length of 2048.
 * `state.eth1DataVotes` has a length between 0 and ETH1_FOLLOW_DISTANCE with an equal probability of each value.
 * So to get the average faster time to key both votesToConsider and state.eth1DataVotes it's better to use
 * fastSerializeEth1Data(). However, a long term solution is to cache valid votes in memory and prevent having
 * to recompute their key on every proposal.
 *
 * With `fastSerializeEth1Data()`: avg time 20 ms/op
 * ✓ pickEth1Vote - no votes                                             233.0587 ops/s    4.290764 ms/op        -        121 runs   1.02 s
 * ✓ pickEth1Vote - max votes                                            29.21546 ops/s    34.22845 ms/op        -         25 runs   1.38 s
 *
 * With `toHexString(ssz.phase0.Eth1Data.hashTreeRoot(eth1Data))`: avg time 23 ms/op
 * ✓ pickEth1Vote - no votes                                             46.12341 ops/s    21.68096 ms/op        -        133 runs   3.40 s
 * ✓ pickEth1Vote - max votes                                            37.89912 ops/s    26.38583 ms/op        -         29 runs   1.27 s
 */
function getEth1DataKey(eth1Data: phase0.Eth1Data): string {
  // return toHexString(ssz.phase0.Eth1Data.hashTreeRoot(eth1Data));
  return fastSerializeEth1Data(eth1Data);
}

/**
 * Serialize eth1Data types to a unique string ID. It is only used for comparison.
 */
export function fastSerializeEth1Data(eth1Data: phase0.Eth1Data): string {
  return toHex(eth1Data.blockHash) + eth1Data.depositCount.toString(16) + toHex(eth1Data.depositRoot);
}

export function votingPeriodStartTime(config: ChainForkConfig, state: BeaconStateAllForks): number {
  const eth1VotingPeriodStartSlot = state.slot - (state.slot % (EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH));
  return computeTimeAtSlot(config, eth1VotingPeriodStartSlot, state.genesisTime);
}
