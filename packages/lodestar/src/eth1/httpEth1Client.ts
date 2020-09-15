import {fromHexString} from "@chainsafe/ssz";
import {AbortSignal} from "abort-controller";
import {fetchRpcBatch} from "./httpRpcClient";
import {IEth1Block} from "./types";

/**
 * Binds return types to Ethereum JSON RPC methods
 */
interface IEthJsonRpcTypes {
  eth_getBlockByNumber: {
    hash: string; // "0x7f0c419985f2227c546a9c640ee05abb3d279316426e6c79d69f6e317d6bb301";
    number: string; // "0x63";
    timestamp: string; // "0x5c5315bb";
  };
}

/**
 * Fetches a range of blocks by blockNumber, inclusive.
 */
export async function fetchBlockRange(
  url: string,
  fromBlockNumber: number,
  toBlockNumber: number,
  signal?: AbortSignal
): Promise<IEth1Block[]> {
  const blockNumbers: number[] = [];
  for (let i = fromBlockNumber; i <= toBlockNumber; i++) {
    blockNumbers.push(i);
  }
  return fetchBlocksByNumber(url, blockNumbers, signal);
}

/**
 * Fetches an arbitrary array of block numbers in batch
 */
async function fetchBlocksByNumber(url: string, blockNumbers: number[], signal?: AbortSignal): Promise<IEth1Block[]> {
  const method = "eth_getBlockByNumber";

  const blocksRaw = await fetchRpcBatch<IEthJsonRpcTypes[typeof method]>(
    url,
    blockNumbers.map((blockNumber) => ({
      method,
      params: ["0x" + blockNumber.toString(16), false],
    })),
    signal
  );

  return blocksRaw.map((blockRaw) => ({
    hash: fromHexString(blockRaw.hash),
    number: parseInt(blockRaw.number, 16),
    timestamp: parseInt(blockRaw.timestamp, 16),
  }));
}
