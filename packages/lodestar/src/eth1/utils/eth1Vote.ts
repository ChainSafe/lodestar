import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Eth1Data} from "@chainsafe/lodestar-types";
import {computeTimeAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString, TreeBacked, readOnlyMap} from "@chainsafe/ssz";
import {mostFrequent} from "../../util/objects";

export function pickEth1Vote(
  config: IBeaconConfig,
  state: TreeBacked<BeaconState>,
  votesToConsider: Eth1Data[]
): Eth1Data {
  const votesToConsiderHashMap = new Set<string>();
  for (const eth1Data of votesToConsider) votesToConsiderHashMap.add(serializeEth1Data(eth1Data));

  const validVotes = readOnlyMap(state.eth1DataVotes, (eth1Data) => eth1Data).filter((eth1Data) =>
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
 */
function serializeEth1Data(eth1Data: Eth1Data): string {
  return toHexString(eth1Data.blockHash) + eth1Data.depositCount.toString(16) + toHexString(eth1Data.depositRoot);
}

export function votingPeriodStartTime(config: IBeaconConfig, state: TreeBacked<BeaconState>): number {
  const eth1VotingPeriodStartSlot =
    state.slot - (state.slot % (config.params.EPOCHS_PER_ETH1_VOTING_PERIOD * config.params.SLOTS_PER_EPOCH));
  return computeTimeAtSlot(config, eth1VotingPeriodStartSlot, state.genesisTime);
}
