import {ChainConfig} from "@lodestar/config";
import {NetworkName} from "@lodestar/config/networks";
import {Logger, LogLevel} from "@lodestar/utils";
import {ProofProvider} from "./proof_provider/proof_provider.js";
import {JsonRpcRequest, JsonRpcRequestOrBatch, JsonRpcResponse, JsonRpcResponseOrBatch} from "./types.js";
import {ELRpcProvider} from "./utils/rpc_provider.js";

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

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export type ELRequestHandlerAny = ELRequestHandler<any, any>;

/**
 * @deprecated Kept for backward compatibility. Use `AnyWeb3Provider` type instead.
 */
export type Web3Provider = object;

export type ELVerifiedRequestHandlerOpts<Params = unknown[]> = {
  payload: JsonRpcRequest<Params>;
  rpc: ELRpcProvider;
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

export type ProviderTypeOptions<T extends boolean | undefined> = {
  /**
   * If user specify custom provider types we will register those at the start in given order.
   * So if you provider [custom1, custom2] and we already have [web3js, ethers] then final order
   * of providers will be [custom1, custom2, web3js, ethers]
   */
  providerTypes?: Web3ProviderType<AnyWeb3Provider>[];
  /**
   * To keep the backward compatible behavior if this option is not set we consider `true` as default.
   * In coming breaking release we may set this option default to `false`.
   */
  mutateProvider?: T;
};

export type VerifiedExecutionInitOptions<T extends boolean | undefined> = LogOptions &
  ConsensusNodeOptions &
  NetworkOrConfig &
  RootProviderOptions &
  ProviderTypeOptions<T>;

export type AnyWeb3Provider = object;

export interface Web3ProviderType<T extends AnyWeb3Provider> {
  name: string;
  matched: (provider: AnyWeb3Provider) => provider is T;
  handler(provider: T): ELRpcProvider["handler"];
  mutateProvider(provider: T, newHandler: ELRpcProvider["handler"]): void;
}
