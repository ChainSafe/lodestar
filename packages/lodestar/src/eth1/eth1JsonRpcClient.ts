import {fromHexString} from "@chainsafe/ssz";
import {Eth1Block} from "@chainsafe/lodestar-types";
import {AbortSignal} from "abort-controller";
import {JsonRpcHttpClient} from "./utils/jsonRpcHttpClient";

/**
 * Binds return types to Ethereum JSON RPC methods
 */
interface IEthJsonRpcTypes {
  eth_getBlockByNumber: {
    hash: string; // "0x7f0c419985f2227c546a9c640ee05abb3d279316426e6c79d69f6e317d6bb301";
    number: string; // "0x63";
    timestamp: string; // "0x5c5315bb";
  };
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

export class Eth1JsonRpcClient {
  private rpc: JsonRpcHttpClient;

  constructor({providerUrl}: {providerUrl: string}) {
    this.rpc = new JsonRpcHttpClient(providerUrl);
  }

  /**
   * Fetches an arbitrary array of block numbers in batch
   */
  async getBlocksByNumber(blockNumbers: number[], signal?: AbortSignal): Promise<Eth1Block[]> {
    const method = "eth_getBlockByNumber";
    const blocksRaw = await this.rpc.fetchBatch<IEthJsonRpcTypes[typeof method]>(
      blockNumbers.map((blockNumber) => ({method, params: [toHex(blockNumber), false]})),
      signal
    );
    return blocksRaw.map(parseBlock);
  }

  async getBlockByNumber(blockNumber: number, signal?: AbortSignal): Promise<Eth1Block> {
    const method = "eth_getBlockByNumber";
    const blocksRaw = await this.rpc.fetch<IEthJsonRpcTypes[typeof method]>(
      {method, params: [toHex(blockNumber), false]},
      signal
    );
    return parseBlock(blocksRaw);
  }

  async getBlockNumber(signal?: AbortSignal): Promise<number> {
    const method = "eth_blockNumber";
    const blockNumberRaw = await this.rpc.fetch<IEthJsonRpcTypes[typeof method]>({method, params: []}, signal);
    return parseInt(blockNumberRaw, 16);
  }

  async getCode(address: string, signal?: AbortSignal): Promise<string> {
    const method = "eth_getCode";
    return await this.rpc.fetch<IEthJsonRpcTypes[typeof method]>({method, params: [address, "latest"]}, signal);
  }

  async getLogs(
    options: {fromBlock?: number; toBlock?: number; address?: string; topics?: string[]; blockhash?: string},
    signal?: AbortSignal
  ): Promise<{blockNumber: number; data: string; topics: string[]}[]> {
    const method = "eth_getLogs";
    const hexOptions = {
      ...options,
      fromBlock: options.fromBlock && toHex(options.fromBlock),
      toBlock: options.toBlock && toHex(options.toBlock),
    };
    const logsRaw = await this.rpc.fetch<IEthJsonRpcTypes[typeof method]>({method, params: [hexOptions]}, signal);
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

function parseBlock(blockRaw: IEthJsonRpcTypes["eth_getBlockByNumber"]): Eth1Block {
  return {
    blockHash: fromHexString(blockRaw.hash),
    blockNumber: parseInt(blockRaw.number, 16),
    timestamp: parseInt(blockRaw.timestamp, 16),
  };
}
