import {toHexString} from "@chainsafe/ssz";
import {DepositEvent} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {AbortSignal} from "abort-controller";
import {isValidAddress} from "../util/address";
import {Eth1JsonRpcClient} from "./eth1JsonRpcClient";
import {IEth1Provider} from "./interface";
import {IEth1Options} from "./options";
import {depositEventTopics, parseDepositLog} from "./utils/depositContract";

export class Eth1Provider extends Eth1JsonRpcClient implements IEth1Provider {
  public deployBlock: number;
  private address: string;
  private config: IBeaconConfig;

  constructor(config: IBeaconConfig, opts: IEth1Options) {
    super(opts);
    this.deployBlock = opts.depositContractDeployBlock;
    this.address = toHexString(config.params.DEPOSIT_CONTRACT_ADDRESS);
    this.config = config;
  }

  async getDepositEvents(fromBlock: number, toBlock?: number, signal?: AbortSignal): Promise<DepositEvent[]> {
    const options = {fromBlock, toBlock, address: this.address, topics: depositEventTopics};
    const logs = await this.getLogs(options, signal);
    return logs.map((log) => parseDepositLog(this.config, log));
  }

  async validateContract(signal?: AbortSignal): Promise<void> {
    if (!isValidAddress(this.address)) {
      throw Error(`Invalid contract address: ${this.address}`);
    }

    const code = await this.getCode(this.address, signal);
    if (!code || code === "0x") {
      throw new Error(`There is no deposit contract at given address: ${this.address}`);
    }
  }
}
