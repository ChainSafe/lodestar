import {ChainConfig} from "@lodestar/config";
import {NetworkName} from "@lodestar/config/networks";
import {Logger, LogLevel} from "@lodestar/utils";
import {ProofProvider} from "./proof_provider/proof_provider.js";
import {JsonRpcRequest, JsonRpcRequestOrBatch, JsonRpcResponse, JsonRpcResponseOrBatch} from "./types.js";
import {ELRpc} from "./utils/rpc.js";

export type {NetworkName} from "@lodestar/config/networks";
export enum LCTransport {
  Rest = "Rest",
  P2P = "P2P",
}

// Provide either network or config. This will be helpful to connect to a custom network
export type NetworkOrConfig = {network: NetworkName; config?: never} | {network?: never; config: Partial<ChainConfig>};

export type RootProviderInitOptions = ConsensusNodeOptions &
  NetworkOrConfig & {
    signal: AbortSignal;
    logger: Logger;
    wsCheckpoint?: string;
    unverifiedWhitelist?: string[];
  };

// The `undefined` is necessary to match the types for the web3 1.x
export type ELRequestHandler<Params = unknown[], Response = unknown> = (
  payload: JsonRpcRequestOrBatch<Params>
) => Promise<JsonRpcResponseOrBatch<Response> | undefined>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ELRequestHandlerAny = ELRequestHandler<any, any>;

// Modern providers uses this structure e.g. Web3 4.x
export interface EIP1193Provider {
  request: (payload: JsonRpcRequestOrBatch) => Promise<JsonRpcResponseOrBatch>;
}

export interface Web3jsProvider {
  request: (payload: JsonRpcRequest) => Promise<JsonRpcResponse>;
}

// Some providers uses `request` instead of the `send`. e.g. Ganache
export interface RequestProvider {
  request(
    payload: JsonRpcRequestOrBatch,
    callback: (err: Error | undefined, response: JsonRpcResponseOrBatch) => void
  ): void;
}

// The legacy Web3 1.x use this structure
export interface SendProvider {
  send(payload: JsonRpcRequest, callback: (err?: Error | null, response?: JsonRpcResponse) => void): void;
}

// Ethers provider uses this structure
export interface EthersProvider {
  // Ethers provider does not have a public interface for batch requests
  send(method: string, params: Array<unknown>): Promise<JsonRpcResponse>;
}

// Some legacy providers use this very old structure
export interface SendAsyncProvider {
  sendAsync(payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch>;
}

export type Web3Provider =
  | SendProvider
  | EthersProvider
  | SendAsyncProvider
  | RequestProvider
  | EIP1193Provider
  | Web3jsProvider;

export type ELVerifiedRequestHandlerOpts<Params = unknown[]> = {
  payload: JsonRpcRequest<Params>;
  rpc: ELRpc;
  proofProvider: ProofProvider;
  logger: Logger;
};

export type ELVerifiedRequestHandler<Params = unknown[], Response = unknown> = (
  opts: ELVerifiedRequestHandlerOpts<Params>
) => Promise<JsonRpcResponse<Response>>;

// Either a logger is provided by user or user specify a log level
// If both are skipped then we don't log anything (useful for browser plugins)
export type LogOptions = {logger?: Logger; logLevel?: never} | {logLevel?: LogLevel; logger?: never};

export type ConsensusNodeOptions =
  | {transport: LCTransport.Rest; urls: string[]}
  | {transport: LCTransport.P2P; bootnodes: string[]};

export type RootProviderOptions = {
  signal?: AbortSignal;
  wsCheckpoint?: string;
  unverifiedWhitelist?: string[];
};

export type VerifiedExecutionInitOptions = LogOptions & ConsensusNodeOptions & NetworkOrConfig & RootProviderOptions;
