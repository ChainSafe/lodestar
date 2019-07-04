/**
 * @module chain/blockAssembly
 */

import {BeaconState, Eth1Data} from "../../../types";
import {BeaconConfig} from "../../../config";
import {IEth1Notifier} from "../../../eth1";
import {Block} from "ethers/providers";
import {mostFrequent} from "../../../util/objects";

export async function bestVoteData(
  config: BeaconConfig,
  state: BeaconState,
  eth1: IEth1Notifier
): Promise<Eth1Data> {

  const [head, latestStateBlock] = await Promise.all([
    eth1.getHead(),
    eth1.getBlock('0x' + state.latestEth1Data.blockHash.toString('hex'))
  ]);
  const validVotes = await filterValidVotes(config, state.eth1DataVotes, eth1, head, latestStateBlock);

  if(validVotes.length === 0) {
    const requiredBlock = head.number - config.params.ETH1_FOLLOW_DISTANCE;
    const blockHash = (await eth1.getBlock(requiredBlock)).hash;
    const [depositCount, depositRoot] = await Promise.all([
      eth1.depositCount(blockHash),
      eth1.depositRoot(blockHash)
    ]);
    return {
      blockHash: Buffer.from(blockHash.slice(2), 'hex'),
      depositCount,
      depositRoot
    };
  } else {
    const frequentVotes = mostFrequent<Eth1Data>(validVotes, config.types.Eth1Data);
    if(frequentVotes.length === 1) {
      return frequentVotes[0];
    } else {
      const blockNumbers = await Promise.all(
        frequentVotes.map(
          (vote) =>
            eth1.getBlock('0x' + vote.blockHash.toString('hex')).then(b => b.number)
        )
      );
      return frequentVotes[blockNumbers.indexOf(Math.max(...blockNumbers))];
    }
  }
}

export async function filterValidVotes(
  config: BeaconConfig,
  votes: Eth1Data[],
  eth1: IEth1Notifier,
  head: Block,
  latestStateBlock: Block): Promise<Eth1Data[]> {
  const potentialVotes = [];
  for(let i = 0; i < votes.length; i++) {
    const vote = votes[i];
    const block = await eth1.getBlock(vote.blockHash.toString('hex'));
    if(block
      && (head.number - block.number) >= config.params.ETH1_FOLLOW_DISTANCE
      && block.number > latestStateBlock.number
    ) {
      const [depositCount, depositRoot] = await Promise.all([
        eth1.depositCount(vote.blockHash.toString('hex')),
        eth1.depositRoot(vote.blockHash.toString('hex'))
      ]);
      if(depositRoot.equals(vote.depositRoot) && depositCount === vote.depositCount) {
        potentialVotes.push(vote);
      }
    }
  }
  return potentialVotes;
}
