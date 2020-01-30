/* eslint-disable @typescript-eslint/no-unused-vars,@typescript-eslint/no-empty-function */
import {EventEmitter} from "events";

import {BeaconState, Eth1Data, Number64, Root} from "@chainsafe/eth2.0-types";

import {IEth1Notifier} from "../";
import {Block} from "ethers/providers";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {hash, intDiv, intToBytes} from "@chainsafe/eth2.0-utils";
import {computeEpochAtSlot} from "@chainsafe/eth2.0-state-transition";

export class InteropEth1Notifier extends EventEmitter implements IEth1Notifier {
  public constructor() {
    super();
  }

  public async start(): Promise<void> {
  }

  public async stop(): Promise<void> {
  }

  public async processBlockHeadUpdate(blockNumber: string|number): Promise<void> {
  }

  public async processDepositLog(dataHex: string, indexHex: string): Promise<void> {
  }

  public async depositRoot(): Promise<Root> {
    return Buffer.alloc(32);
  }

  public async getBlock(blockHashOrBlockNumber: string | number): Promise<Block> {
    return null as unknown as Block;
  }

  public async getHead(): Promise<Block> {
    return null as unknown as Block;
  }

  public async depositCount(block?: string | number): Promise<Number64> {
    return 0;
  }

  public async processPastDeposits(fromBlock: string | number, toBlock?: string | number): Promise<void> {
    return;
  }

  public async getEth1Vote(config: IBeaconConfig, state: BeaconState): Promise<Eth1Data> {
    const epochsPerPeriod = intDiv(config.params.SLOTS_PER_ETH1_VOTING_PERIOD, config.params.SLOTS_PER_EPOCH);
    const votingPeriod = intDiv(computeEpochAtSlot(config, state.slot), epochsPerPeriod);
    const depositRoot = hash(intToBytes(votingPeriod, 32));
    return {
      depositRoot,
      depositCount: state.eth1DepositIndex,
      blockHash: hash(depositRoot)
    };
  }

  public async getEth1Data(eth1Head: Block, distance: number): Promise<Eth1Data> {
    return null;
  }
}
