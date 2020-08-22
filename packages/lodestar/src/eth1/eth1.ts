import {
  IEth1Streamer,
  IEth1Provider,
  IEth1StreamParams,
  IBatchDepositEvents,
  IDepositEvent,
  IEth1Block,
} from "./interface";
import {getDepositsStream, getDepositsAndBlockStreamForGenesis} from "./stream";

export class Eth1Streamer implements IEth1Streamer {
  provider: IEth1Provider;
  params: IEth1StreamParams;

  constructor(provider: IEth1Provider, params: IEth1StreamParams) {
    this.provider = provider;
    this.params = params;
  }

  getDepositsStream(fromBlock: number): AsyncGenerator<IBatchDepositEvents> {
    fromBlock = Math.max(fromBlock, this.provider.deployBlock);
    return getDepositsStream(fromBlock, this.provider, this.params);
  }

  getDepositsAndBlockStreamForGenesis(fromBlock: number): AsyncGenerator<[IDepositEvent[], IEth1Block]> {
    fromBlock = Math.max(fromBlock, this.provider.deployBlock);
    return getDepositsAndBlockStreamForGenesis(fromBlock, this.provider, this.params);
  }
}
