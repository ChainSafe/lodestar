import {ChainForkConfig} from "@lodestar/config";
import {NetworkName} from "@lodestar/config/networks";
import {ProofProvider} from "./proof_provider/proof_provider.js";
import {ELRequestPayload, ELResponse} from "./types.js";

export enum LightNode {
  Rest = "Rest",
  P2P = "P2P",
}

export interface RootProviderOptions {
  network: NetworkName;
  signal: AbortSignal;
  config?: ChainForkConfig;
}

export type ELRequestMethod = (payload: ELRequestPayload) => Promise<ELResponse | undefined>;

export interface EIP1193Provider {
  request: (payload: ELRequestPayload) => Promise<ELResponse>;
}

export interface RequestProvider {
  request(payload: ELRequestPayload, callback: (err: Error | undefined, response: ELResponse) => void): void;
}

export interface SendProvider {
  send(payload: ELRequestPayload, callback: (err?: Error | null, response?: ELResponse) => void): void;
}

export interface SendAsyncProvider {
  sendAsync(payload: ELRequestPayload): Promise<ELResponse>;
}

export interface EthersProvider {
  send(method: string, params: Array<unknown>): Promise<ELResponse>;
}

export type Web3Provider = SendProvider | EthersProvider | SendAsyncProvider | RequestProvider | EIP1193Provider;

export type ELVerifiedRequestHandler<A = unknown, R = unknown> = (opts: {
  payload: ELRequestPayload<A>;
  handler: ELRequestMethod;
  rootProvider: ProofProvider;
}) => Promise<ELResponse<R>>;
