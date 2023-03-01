import {NetworkName} from "@lodestar/config/networks";
import {RootProvider} from "./root_provider/root_provider.js";
import {ELRequestPayload, ELResponse} from "./types.js";

export enum LightNode {
  Rest = "Rest",
  P2P = "P2P",
}

export interface RootProviderInitOptions {
  network: NetworkName;
  signal: AbortSignal;
  checkpoint?: string;
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

export type Web3Provider = EIP1193Provider | RequestProvider | SendProvider | SendAsyncProvider;

export type ELRequestVerifier<A = unknown, R = unknown> = (opts: {
  payload: ELRequestPayload<A>;
  response: ELResponse<R>;
  handler: ELRequestMethod;
  rootProvider: RootProvider;
}) => Promise<boolean>;
