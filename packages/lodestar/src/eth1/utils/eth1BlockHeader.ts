import {IEth1BlockHeader} from "../types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

/**
 * Enforces the condition `isCandidateBlock` on a blockStream in reverse (from N -> N-1)
 * ```js
 * block.timestamp + SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE <= periodStart &&
 * block.timestamp + SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE * 2 >= periodStart
 * ```
 */
export async function getCandidateBlocksFromStream(
  config: IBeaconConfig,
  periodStart: number,
  blockHeaderDescendingStream: AsyncIterable<IEth1BlockHeader>
): Promise<IEth1BlockHeader[]> {
  const eth1BlockHeaders: IEth1BlockHeader[] = [];
  const {SECONDS_PER_ETH1_BLOCK, ETH1_FOLLOW_DISTANCE} = config.params;

  // block.timestamp <= periodStart - SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE
  const upperTimestamp = periodStart - SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE;
  // block.timestamp >= periodStart - SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE * 2
  const lowerTimestamp = periodStart - SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE * 2;

  for await (const block of blockHeaderDescendingStream) {
    if (block.timestamp < lowerTimestamp) break;
    if (block.timestamp <= upperTimestamp) eth1BlockHeaders.push(block);
  }

  return eth1BlockHeaders.reverse();
}
