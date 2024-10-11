import {phase0} from "@lodestar/types";
import {ChainConfig} from "@lodestar/config";
import {fromHex, isErrorAborted, createElapsedTimeTracker, toPrintableUrl, toHex} from "@lodestar/utils";
import {Logger} from "@lodestar/logger";

import {FetchError, isFetchError} from "@lodestar/api";
import {linspace} from "../../util/numpy.js";
import {depositEventTopics, parseDepositLog} from "../utils/depositContract.js";
import {Eth1Block, Eth1ProviderState, IEth1Provider} from "../interface.js";
import {DEFAULT_PROVIDER_URLS, Eth1Options} from "../options.js";
import {isValidAddress} from "../../util/address.js";
import {EthJsonRpcBlockRaw} from "../interface.js";
import {HTTP_CONNECTION_ERROR_CODES, HTTP_FATAL_ERROR_CODES} from "../../execution/engine/utils.js";
import {
  ErrorJsonRpcResponse,
  HttpRpcError,
  JsonRpcHttpClient,
  JsonRpcHttpClientEvent,
  JsonRpcHttpClientMetrics,
  ReqOpts,
} from "./jsonRpcHttpClient.js";
import {isJsonRpcTruncatedError, quantityToNum, numToQuantity, dataToBytes} from "./utils.js";

/**
 * Binds return types to Ethereum JSON RPC methods
 */
type EthJsonRpcReturnTypes = {
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
};

// Define static options once to prevent extra allocations
const getBlocksByNumberOpts: ReqOpts = {routeId: "getBlockByNumber_batched"};
const getBlockByNumberOpts: ReqOpts = {routeId: "getBlockByNumber"};
const getBlockByHashOpts: ReqOpts = {routeId: "getBlockByHash"};
const getBlockNumberOpts: ReqOpts = {routeId: "getBlockNumber"};
const getLogsOpts: ReqOpts = {routeId: "getLogs"};

const isOneMinutePassed = createElapsedTimeTracker({minElapsedTime: 60_000});

export class Eth1Provider implements IEth1Provider {
  readonly deployBlock: number;
  private readonly depositContractAddress: string;
  private readonly rpc: JsonRpcHttpClient;
  // The default state is ONLINE, it will be updated to offline if we receive a http error
  private state: Eth1ProviderState = Eth1ProviderState.ONLINE;
  private logger?: Logger;

  constructor(
    config: Pick<ChainConfig, "DEPOSIT_CONTRACT_ADDRESS">,
    opts: Pick<Eth1Options, "depositContractDeployBlock" | "providerUrls" | "jwtSecretHex" | "jwtId" | "jwtVersion"> & {
      logger?: Logger;
    },
    signal?: AbortSignal,
    metrics?: JsonRpcHttpClientMetrics | null
  ) {
    this.logger = opts.logger;
    this.deployBlock = opts.depositContractDeployBlock ?? 0;
    this.depositContractAddress = toHex(config.DEPOSIT_CONTRACT_ADDRESS);

    const providerUrls = opts.providerUrls ?? DEFAULT_PROVIDER_URLS;
    this.rpc = new JsonRpcHttpClient(providerUrls, {
      signal,
      // Don't fallback with is truncated error. Throw early and let the retry on this class handle it
      shouldNotFallback: isJsonRpcTruncatedError,
      jwtSecret: opts.jwtSecretHex ? fromHex(opts.jwtSecretHex) : undefined,
      jwtId: opts.jwtId,
      jwtVersion: opts.jwtVersion,
      metrics: metrics,
    });
    this.logger?.info("Eth1 provider", {urls: providerUrls.map(toPrintableUrl).toString()});

    this.rpc.emitter.on(JsonRpcHttpClientEvent.RESPONSE, () => {
      const oldState = this.state;
      this.state = Eth1ProviderState.ONLINE;

      if (oldState !== Eth1ProviderState.ONLINE) {
        this.logger?.info("Eth1 provider is back online", {oldState, newState: this.state});
      }
    });

    this.rpc.emitter.on(JsonRpcHttpClientEvent.ERROR, ({error}) => {
      if (isErrorAborted(error)) {
        this.state = Eth1ProviderState.ONLINE;
      } else if ((error as unknown) instanceof HttpRpcError || (error as unknown) instanceof ErrorJsonRpcResponse) {
        this.state = Eth1ProviderState.ERROR;
      } else if (error && isFetchError(error) && HTTP_FATAL_ERROR_CODES.includes((error as FetchError).code)) {
        this.state = Eth1ProviderState.OFFLINE;
      } else if (error && isFetchError(error) && HTTP_CONNECTION_ERROR_CODES.includes((error as FetchError).code)) {
        this.state = Eth1ProviderState.AUTH_FAILED;
      }

      if (this.state !== Eth1ProviderState.ONLINE) {
        if (isOneMinutePassed()) {
          this.logger?.error(
            "Eth1 provider error",
            {
              state: this.state,
              lastErrorAt: new Date(Date.now() - isOneMinutePassed.msSinceLastCall).toLocaleTimeString(),
            },
            error
          );
        }
      }
    });
  }

  getState(): Eth1ProviderState {
    return this.state;
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
    const logsRawArr = await this.getLogs({
      fromBlock,
      toBlock,
      address: this.depositContractAddress,
      topics: depositEventTopics,
    });
    return logsRawArr.flat(1).map((log) => parseDepositLog(log));
  }

  /**
   * Fetches an arbitrary array of block numbers in batch
   */
  async getBlocksByNumber(fromBlock: number, toBlock: number): Promise<EthJsonRpcBlockRaw[]> {
    const method = "eth_getBlockByNumber";
    const blocksArr = await this.rpc.fetchBatch<EthJsonRpcReturnTypes[typeof method]>(
      linspace(fromBlock, toBlock).map((blockNumber) => ({method, params: [numToQuantity(blockNumber), false]})),
      getBlocksByNumberOpts
    );
    const blocks: EthJsonRpcBlockRaw[] = [];
    for (const block of blocksArr.flat(1)) {
      if (block) blocks.push(block);
    }
    return blocks;
  }

  async getBlockByNumber(blockNumber: number | "latest"): Promise<EthJsonRpcBlockRaw | null> {
    const method = "eth_getBlockByNumber";
    const blockNumberHex = typeof blockNumber === "string" ? blockNumber : numToQuantity(blockNumber);
    return this.rpc.fetch<EthJsonRpcReturnTypes[typeof method]>(
      // false = include only transaction roots, not full objects
      {method, params: [blockNumberHex, false]},
      getBlockByNumberOpts
    );
  }

  async getBlockByHash(blockHashHex: string): Promise<EthJsonRpcBlockRaw | null> {
    const method = "eth_getBlockByHash";
    return this.rpc.fetch<EthJsonRpcReturnTypes[typeof method]>(
      // false = include only transaction roots, not full objects
      {method, params: [blockHashHex, false]},
      getBlockByHashOpts
    );
  }

  async getBlockNumber(): Promise<number> {
    const method = "eth_blockNumber";
    const blockNumberRaw = await this.rpc.fetch<EthJsonRpcReturnTypes[typeof method]>(
      {method, params: []},
      getBlockNumberOpts
    );
    return parseInt(blockNumberRaw, 16);
  }

  async getCode(address: string): Promise<string> {
    const method = "eth_getCode";
    return this.rpc.fetch<EthJsonRpcReturnTypes[typeof method]>({method, params: [address, "latest"]});
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
      fromBlock: numToQuantity(options.fromBlock),
      toBlock: numToQuantity(options.toBlock),
    };
    const logsRaw = await this.rpc.fetch<EthJsonRpcReturnTypes[typeof method]>(
      {method, params: [hexOptions]},
      getLogsOpts
    );
    return logsRaw.map((logRaw) => ({
      blockNumber: parseInt(logRaw.blockNumber, 16),
      data: logRaw.data,
      topics: logRaw.topics,
    }));
  }
}

export function parseEth1Block(blockRaw: EthJsonRpcBlockRaw): Eth1Block {
  if (typeof blockRaw !== "object") throw Error("block is not an object");
  return {
    blockHash: dataToBytes(blockRaw.hash, 32),
    blockNumber: quantityToNum(blockRaw.number, "block.number"),
    timestamp: quantityToNum(blockRaw.timestamp, "block.timestamp"),
  };
}
