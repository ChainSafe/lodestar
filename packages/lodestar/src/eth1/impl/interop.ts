/* eslint-disable @typescript-eslint/no-unused-vars,@typescript-eslint/no-empty-function */
import {EventEmitter} from "events";
import {Block} from "ethers/providers";

import {hash} from "@chainsafe/ssz";
import {BeaconState, Eth1Data, Number64, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {intDiv, intToBytes} from "@chainsafe/lodestar-utils";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

import {IEth1Notifier} from "../";

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

  public async depositRoot(): Promise<Uint8Array> {
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
    const epochsPerPeriod = config.params.EPOCHS_PER_ETH1_VOTING_PERIOD;
    const votingPeriod = intDiv(computeEpochAtSlot(config, state.slot), epochsPerPeriod);
    const depositRoot = hash(intToBytes(votingPeriod, 32));
    return {
      depositRoot,
      depositCount: state.eth1DepositIndex,
      blockHash: hash(depositRoot)
    };
  }

  public async getEth1Data(eth1Head: Block): Promise<Eth1Data> {
    return null;

  }

  public initBlockCache(config: IBeaconConfig, state: BeaconState): Promise<void> {
    return Promise.resolve();
  }

  public pruneBlockCache(config: IBeaconConfig, finalizedState: BeaconState): void {

  }

  public findBlocks(config: IBeaconConfig, periodStart: Number64): Block[] {
    return [];
  }
}
