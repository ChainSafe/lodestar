import {fromHexString, toHexString} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {AbortSignal} from "@chainsafe/abort-controller";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {chunkifyInclusiveRange} from "../../util/chunkify";
import {linspace} from "../../util/numpy";
import {retry} from "../../util/retry";
import {ErrorParseJson, JsonRpcHttpClient} from "./jsonRpcHttpClient";
import {depositEventTopics, parseDepositLog} from "../utils/depositContract";
import {IEth1Provider} from "../interface";
import {Eth1Options} from "../options";
import {isValidAddress} from "../../util/address";
import {EthJsonRpcBlockRaw} from "../interface";

/* eslint-disable @typescript-eslint/naming-convention */

export const rootHexRegex = /^0x[a-fA-F0-9]{64}$/;

/**
 * Binds return types to Ethereum JSON RPC methods
 */
interface IEthJsonRpcTypes {
  eth_getBlockByNumber: EthJsonRpcBlockRaw | null;
  eth_getBlockByHash: EthJsonRpcBlockRaw | null;
  eth_blockNumber: string;
  eth_getCode: string;
  eth_getLogs: {
    removed: boolean;
    logIndex: string;
    transactionIndex: string;
    transactionHash: string;
    blockHash: string;
    blockNumber: string;
    address: string;
    data: string;
    topics: string[];
  }[];
}

export class Eth1Provider implements IEth1Provider {
  readonly deployBlock: number;
  private readonly depositContractAddress: string;
  private readonly rpc: JsonRpcHttpClient;

  constructor(config: IChainConfig, opts: Eth1Options, signal: AbortSignal) {
    this.deployBlock = opts.depositContractDeployBlock;
    this.depositContractAddress = toHexString(config.DEPOSIT_CONTRACT_ADDRESS);
    this.rpc = new JsonRpcHttpClient(opts.providerUrls, {
      signal,
      // Don't fallback with is truncated error. Throw early and let the retry on this class handle it
      shouldNotFallback: isJsonRpcTruncatedError,
    });
  }

  async validateContract(): Promise<void> {
    if (!isValidAddress(this.depositContractAddress)) {
      throw Error(`Invalid contract address: ${this.depositContractAddress}`);
    }

    const code = await this.getCode(this.depositContractAddress);
    if (!code || code === "0x") {
      throw new Error(`There is no deposit contract at given address: ${this.depositContractAddress}`);
    }
  }

  async getDepositEvents(fromBlock: number, toBlock: number): Promise<phase0.DepositEvent[]> {
    const logsRawArr = await retry(
      (attempt) => {
        // Large log requests can return with code 200 but truncated, with broken JSON
        // This retry will split a given block range into smaller ranges exponentially
        // The underlying http client should handle network errors and retry
        const chunkCount = 2 ** (attempt - 1);
        const blockRanges = chunkifyInclusiveRange(fromBlock, toBlock, chunkCount);
        return Promise.all(
          blockRanges.map(([from, to]) => {
            const options = {
              fromBlock: from,
              toBlock: to,
              address: this.depositContractAddress,
              topics: depositEventTopics,
            };
            return this.getLogs(options);
          })
        );
      },
      {
        retries: 3,
        retryDelay: 3000,
        shouldRetry: isJsonRpcTruncatedError,
      }
    );

    return logsRawArr.flat(1).map((log) => parseDepositLog(log));
  }

  /**
   * Fetches an arbitrary array of block numbers in batch
   */
  async getBlocksByNumber(fromBlock: number, toBlock: number): Promise<EthJsonRpcBlockRaw[]> {
    const method = "eth_getBlockByNumber";
    const blocksArr = await retry(
      (attempt) => {
        // Large batch requests can return with code 200 but truncated, with broken JSON
        // This retry will split a given block range into smaller ranges exponentially
        // The underlying http client should handle network errors and retry
        const chunkCount = 2 ** (attempt - 1);
        const blockRanges = chunkifyInclusiveRange(fromBlock, toBlock, chunkCount);
        return Promise.all(
          blockRanges.map(([from, to]) =>
            this.rpc.fetchBatch<IEthJsonRpcTypes[typeof method]>(
              linspace(from, to).map((blockNumber) => ({method, params: [toHex(blockNumber), false]}))
            )
          )
        );
      },
      {
        retries: 3,
        retryDelay: 3000,
        shouldRetry: isJsonRpcTruncatedError,
      }
    );

    const blocks: EthJsonRpcBlockRaw[] = [];
    for (const block of blocksArr.flat(1)) {
      if (block) blocks.push(block);
    }
    return blocks;
  }

  async getBlockByNumber(blockNumber: number | "latest"): Promise<EthJsonRpcBlockRaw | null> {
    const method = "eth_getBlockByNumber";
    const blockNumberHex = typeof blockNumber === "string" ? blockNumber : toHex(blockNumber);
    return await this.rpc.fetch<IEthJsonRpcTypes[typeof method]>({
      method,
      // false = include only transaction roots, not full objects
      params: [blockNumberHex, false],
    });
  }

  async getBlockByHash(blockHashHex: string): Promise<EthJsonRpcBlockRaw | null> {
    const method = "eth_getBlockByHash";
    return await this.rpc.fetch<IEthJsonRpcTypes[typeof method]>({
      method,
      // false = include only transaction roots, not full objects
      params: [blockHashHex, false],
    });
  }

  async getBlockNumber(): Promise<number> {
    const method = "eth_blockNumber";
    const blockNumberRaw = await this.rpc.fetch<IEthJsonRpcTypes[typeof method]>({method, params: []});
    return parseInt(blockNumberRaw, 16);
  }

  async getCode(address: string): Promise<string> {
    const method = "eth_getCode";
    return await this.rpc.fetch<IEthJsonRpcTypes[typeof method]>({method, params: [address, "latest"]});
  }

  async getLogs(options: {
    fromBlock: number;
    toBlock: number;
    address: string;
    topics: string[];
  }): Promise<{blockNumber: number; data: string; topics: string[]}[]> {
    const method = "eth_getLogs";
    const hexOptions = {
      ...options,
      fromBlock: toHex(options.fromBlock),
      toBlock: toHex(options.toBlock),
    };
    const logsRaw = await this.rpc.fetch<IEthJsonRpcTypes[typeof method]>({method, params: [hexOptions]});
    return logsRaw.map((logRaw) => ({
      blockNumber: parseInt(logRaw.blockNumber, 16),
      data: logRaw.data,
      topics: logRaw.topics,
    }));
  }
}

function toHex(n: number): string {
  return "0x" + n.toString(16);
}

export function parseEth1Block(blockRaw: EthJsonRpcBlockRaw): phase0.Eth1Block {
  if (typeof blockRaw !== "object") throw Error("block is not an object");
  validateHexRoot(blockRaw.hash);
  return {
    blockHash: fromHexString(blockRaw.hash),
    blockNumber: hexToDecimal(blockRaw.number, "block.number"),
    timestamp: hexToDecimal(blockRaw.timestamp, "block.timestamp"),
  };
}

export function isJsonRpcTruncatedError(error: Error): boolean {
  return (
    // Truncated responses usually get as 200 but since it's truncated the JSON will be invalid
    error instanceof ErrorParseJson ||
    // Otherwise guess Infura error message of too many events
    (error instanceof Error && error.message.includes("query returned more than 10000 results"))
  );
}

/** Safe parser of hex decimal positive integers */
export function hexToDecimal(hex: string, id = ""): number {
  const num = parseInt(hex, 16);
  if (isNaN(num) || num < 0) throw Error(`Invalid hex decimal ${id} '${hex}'`);
  return num;
}

/** Typesafe fn to convert hex string to bigint. The BigInt constructor param is any */
export function hexToBigint(hex: string, id = ""): bigint {
  try {
    return BigInt(hex);
  } catch (e) {
    throw Error(`Invalid hex bigint ${id} '${hex}': ${(e as Error).message}`);
  }
}

export function validateHexRoot(hex: string, id = ""): void {
  if (!rootHexRegex.test(hex)) throw Error(`Invalid hex root ${id} '${hex}'`);
}
