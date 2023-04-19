import {ChainForkConfig} from "@lodestar/config";
import {NetworkName} from "@lodestar/config/networks";
import {Logger, LogLevel} from "@lodestar/utils";
import {ProofProvider} from "./proof_provider/proof_provider.js";
import {ELRequestPayload, ELResponse} from "./types.js";

export enum LCTransport {
  Rest = "Rest",
  P2P = "P2P",
}

export type RootProviderInitOptions = {
  network: NetworkName;
  signal: AbortSignal;
  logger: Logger;
  config?: ChainForkConfig;
  wsCheckpoint?: string;
} & ConsensusNodeOptions;

// The `undefined` is necessary to match the types for the web3 1.x
export type ELRequestHandler<Params = unknown[], Response = unknown> = (
  payload: ELRequestPayload<Params>
) => Promise<ELResponse<Response> | undefined>;

// Modern providers uses this structure e.g. Web3 4.x
export interface EIP1193Provider {
  request: (payload: ELRequestPayload) => Promise<ELResponse>;
}

// Some providers uses `request` instead of the `send`. e.g. Ganache
export interface RequestProvider {
  request(payload: ELRequestPayload, callback: (err: Error | undefined, response: ELResponse) => void): void;
}

// The legacy Web3 1.x use this structure
export interface SendProvider {
  send(payload: ELRequestPayload, callback: (err?: Error | null, response?: ELResponse) => void): void;
}

// Ethers provider uses this structure
export interface EthersProvider {
  send(method: string, params: Array<unknown>): Promise<ELResponse>;
}

// Some legacy providers use this very old structure
export interface SendAsyncProvider {
  sendAsync(payload: ELRequestPayload): Promise<ELResponse>;
}

export type Web3Provider = SendProvider | EthersProvider | SendAsyncProvider | RequestProvider | EIP1193Provider;

export type ELVerifiedRequestHandlerOpts<Params = unknown[], Response = unknown> = {
  payload: ELRequestPayload<Params>;
  handler: ELRequestHandler<Params, Response>;
  proofProvider: ProofProvider;
  logger: Logger;
  network: NetworkName;
};

export type ELVerifiedRequestHandler<Params = unknown[], Response = unknown> = (
  opts: ELVerifiedRequestHandlerOpts<Params, Response>
) => Promise<ELResponse<Response>>;

// Either a logger is provided by user or user specify a log level
// If both are skipped then we don't log anything (useful for browser plugins)
export type LogOptions = {logger?: Logger; logLevel?: never} | {logLevel?: LogLevel; logger?: never};

export type ConsensusNodeOptions =
  | {transport: LCTransport.Rest; urls: string[]}
  | {transport: LCTransport.P2P; bootnodes: string[]};
