import {BeaconState, Number64} from "@chainsafe/lodestar-types";
import {Block} from "ethers/providers";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeTimeAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {Eth1BlockRange} from "../interface";

export function votingPeriodStartTime(config: IBeaconConfig, state: BeaconState): Number64 {
  const eth1VotingPeriodStartSlot = state.slot -
    state.slot % (config.params.SLOTS_PER_ETH1_VOTING_PERIOD);
  return computeTimeAtSlot(config, eth1VotingPeriodStartSlot, state.genesisTime);
}

export function isCandidateBlock(config: IBeaconConfig, block: Block, periodStart: Number64): boolean {
  const params = config.params;
  return (
    block.timestamp <= periodStart - params.SECONDS_PER_ETH1_BLOCK * params.ETH1_FOLLOW_DISTANCE &&
    block.timestamp >= periodStart - params.SECONDS_PER_ETH1_BLOCK * params.ETH1_FOLLOW_DISTANCE * 2
  );
}

export function getLatestEth1BlockTimestamp(
  config: IBeaconConfig,
  state: BeaconState): Number64 {
  const periodStart = votingPeriodStartTime(config, state);
  return periodStart - config.params.SECONDS_PER_ETH1_BLOCK * config.params.ETH1_FOLLOW_DISTANCE * 2;
}

/**
 * Get initial eth1 blocks to cache.
 * @param slot 
 */
export function getEth1BlockCandidateRange(
  config: IBeaconConfig,
  state: BeaconState,
  eth1Head: Block): Eth1BlockRange {
  const params = config.params;
  const periodStart = votingPeriodStartTime(config, state);

  const fromNumber = eth1Head.number - Math.ceil((eth1Head.timestamp - periodStart) / params.SECONDS_PER_ETH1_BLOCK) -
    params.ETH1_FOLLOW_DISTANCE * 2;
  const toNumber = eth1Head.number - Math.floor((eth1Head.timestamp - periodStart) / params.SECONDS_PER_ETH1_BLOCK) -
    params.ETH1_FOLLOW_DISTANCE;
  return {fromNumber, toNumber};
}