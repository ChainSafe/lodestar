import {toHexString} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {AbortSignal} from "@chainsafe/abort-controller";
import {isValidAddress} from "../util/address";
import {retry} from "../util/retry";
import {chunkifyInclusiveRange} from "../util/chunkify";
import {ErrorParseJson} from "./jsonRpcHttpClient";
import {Eth1JsonRpcClient} from "./eth1JsonRpcClient";
import {IEth1Provider} from "./interface";
import {IEth1Options} from "./options";
import {depositEventTopics, parseDepositLog} from "./utils/depositContract";

export class Eth1Provider extends Eth1JsonRpcClient implements IEth1Provider {
  deployBlock: number;
  private address: string;
  private config: IChainForkConfig;

  constructor(config: IChainForkConfig, opts: IEth1Options) {
    super(opts);
    this.deployBlock = opts.depositContractDeployBlock;
    this.address = toHexString(config.DEPOSIT_CONTRACT_ADDRESS);
    this.config = config;
  }

  async getDepositEvents(fromBlock: number, toBlock: number, signal?: AbortSignal): Promise<phase0.DepositEvent[]> {
    const logsRawArr = await retry(
      (attempt) => {
        // Large log requests can return with code 200 but truncated, with broken JSON
        // This retry will split a given block range into smaller ranges exponentially
        // The underlying http client should handle network errors and retry
        const chunkCount = 2 ** (attempt - 1);
        const blockRanges = chunkifyInclusiveRange(fromBlock, toBlock, chunkCount);
        return Promise.all(
          blockRanges.map(([from, to]) => {
            const options = {fromBlock: from, toBlock: to, address: this.address, topics: depositEventTopics};
            return this.getLogs(options, signal);
          })
        );
      },
      {
        retries: 3,
        shouldRetry: (lastError) => lastError instanceof ErrorParseJson,
      }
    );

    return logsRawArr.flat(1).map((log) => parseDepositLog(log));
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
