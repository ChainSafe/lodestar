import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Eth1Data} from "@chainsafe/lodestar-types";
import {computeTimeAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {mostFrequent} from "../../util/objects";

export interface IEth1DataBlock extends Eth1Data {
  timestamp: number;
  blockNumber: number;
}

export function getEth1Vote(
  config: IBeaconConfig,
  state: TreeBacked<BeaconState>,
  eth1Blocks: IEth1DataBlock[]
): Eth1Data {
  const periodStart = votingPeriodStartTime(config, state);

  const votesToConsider = eth1Blocks.filter(
    (eth1DataBlock) =>
      isCandidateBlock(config, eth1DataBlock, periodStart) &&
      // Ensure cannot move back to earlier deposit contract states
      eth1DataBlock.depositCount >= state.eth1Data.depositCount
  );

  const votesToConsiderHashMap = new Set<string>();
  for (const eth1Data of votesToConsider) votesToConsiderHashMap.add(serializeEth1Data(eth1Data));

  const validVotes = Array.from(state.eth1DataVotes).filter((eth1Data) =>
    votesToConsiderHashMap.has(serializeEth1Data(eth1Data))
  );

  if (validVotes.length > 0) {
    const frequentVotes = mostFrequent<Eth1Data>(config.types.Eth1Data, validVotes);
    if (frequentVotes.length === 1) {
      return frequentVotes[0];
    } else {
      return validVotes[
        Math.max(
          ...frequentVotes.map((vote) =>
            validVotes.findIndex((eth1Data) => config.types.Eth1Data.equals(vote, eth1Data))
          )
        )
      ];
    }
  } else {
    return votesToConsider[votesToConsider.length - 1] || state.eth1Data;
  }
}

/**
 * Serialize eth1Data types to a unique string ID. It is only used for comparison.
 * @param eth1Data
 */
function serializeEth1Data(eth1Data: Eth1Data): string {
  return toHexString(eth1Data.blockHash) + eth1Data.depositCount.toString(16) + toHexString(eth1Data.depositRoot);
}

export function votingPeriodStartTime(config: IBeaconConfig, state: TreeBacked<BeaconState>): number {
  const eth1VotingPeriodStartSlot =
    state.slot - (state.slot % (config.params.EPOCHS_PER_ETH1_VOTING_PERIOD * config.params.SLOTS_PER_EPOCH));
  return computeTimeAtSlot(config, eth1VotingPeriodStartSlot, state.genesisTime);
}

export function isCandidateBlock(config: IBeaconConfig, block: IEth1DataBlock, periodStart: number): boolean {
  const {SECONDS_PER_ETH1_BLOCK, ETH1_FOLLOW_DISTANCE} = config.params;
  return (
    block.timestamp + SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE <= periodStart &&
    block.timestamp + SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE * 2 >= periodStart
  );
}
