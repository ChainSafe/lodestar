import {describe, it} from "mocha";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import { BeaconState } from "@chainsafe/lodestar-types";
import { generateState } from "../../../utils/state";
import { Block } from "ethers/providers";
import { generateEth1BLock } from "../../../utils/eth1Block";
import { getEth1BlockCandidateRange, votingPeriodStartTime, isCandidateBlock } from "../../../../src/eth1/impl/utils";

describe("getEth1BlockCandidateRange", () => {

  const genesisTime = Math.floor(new Date("2020-01-01").getTime() / 1000);
  it("should calculate correct Eth1BlockRange", () => {
    const state: BeaconState = generateState({slot: 500, genesisTime}, config);
    const eth1HeadTimestamp = Math.floor(Date.now()/1000);
    const eth1Head: Block = generateEth1BLock({number: 9757581, timestamp: eth1HeadTimestamp});
    // calculate block range
    const range = getEth1BlockCandidateRange(config, state, eth1Head);
    expect(range.fromNumber).to.be.gt(0);
    expect(range.toNumber).to.be.gt(0);
    expect(range.toNumber - range.fromNumber).to.be.gte(config.params.ETH1_FOLLOW_DISTANCE);
    expect(range.toNumber - range.fromNumber).to.be.lte(config.params.ETH1_FOLLOW_DISTANCE + 2);
    // generate data for eth1 blocks and check isCandidateBlock
    const blocks: Block[] = [];
    for (let number = range.fromNumber; number <= range.toNumber; number++) {
      const block = generateEth1BLock({
        number, 
        timestamp: (eth1HeadTimestamp - (eth1Head.number - number) * config.params.SECONDS_PER_ETH1_BLOCK)
      });
      blocks.push(block);
    }
    const periodStart = votingPeriodStartTime(config, state);
    const candidateBlocks = blocks.filter(block => isCandidateBlock(config, block, periodStart));
    expect(candidateBlocks.length).to.be.equal(config.params.ETH1_FOLLOW_DISTANCE);
  });
});