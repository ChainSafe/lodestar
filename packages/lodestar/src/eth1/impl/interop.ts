import {EventEmitter} from "events";

import {BeaconState, bytes32, Epoch, Eth1Data, Hash, number64} from "@chainsafe/eth2.0-types";

import {IEth1Notifier} from "../";
import {Block} from "ethers/providers";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {intDiv} from "../../util/math";
import {hash} from "../../util/crypto";
import {intToBytes} from "../../util/bytes";

export class InteropEth1Notifier extends EventEmitter implements IEth1Notifier {
  public constructor() {
    super();
  }

  public async start(): Promise<void> {
  }

  public async stop(): Promise<void> {
  }

  public async processBlockHeadUpdate(blockNumber): Promise<void> {
  }

  public async processDepositLog(dataHex: string, indexHex: string): Promise<void> {
  }

  public async depositRoot(): Promise<Hash> {
    return Buffer.alloc(32);
  }

  public async getBlock(blockHashOrBlockNumber: string | number): Promise<Block> {
    return undefined;
  }

  public async getHead(): Promise<Block> {
    return undefined;
  }

  public async depositCount(block?: string | number): Promise<number64> {
    return undefined;
  }

  public async processPastDeposits(fromBlock: string | number, toBlock?: string | number): Promise<void> {
    return undefined;
  }

  public async getEth1Data(config: IBeaconConfig, state: BeaconState, currentEpoch: Epoch): Promise<Eth1Data> {
    const epochsPerPeriod = intDiv(config.params.SLOTS_PER_ETH1_VOTING_PERIOD, config.params.SLOTS_PER_EPOCH);
    const votingPeriod = intDiv(currentEpoch, epochsPerPeriod);
    const depositRoot = hash(intToBytes(votingPeriod, 32));
    return {
      depositRoot,
      depositCount: state.eth1DepositIndex,
      blockHash: hash(depositRoot)
    };
  }
}
