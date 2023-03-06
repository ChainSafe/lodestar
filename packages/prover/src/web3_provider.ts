import {NetworkName} from "@lodestar/config/networks";
import {
  EIP1193Provider,
  LightNode,
  RequestProvider,
  SendAsyncProvider,
  SendProvider,
  Web3Provider,
} from "./interfaces.js";
import {ProofProvider} from "./proof_provider/proof_provider.js";
import {ELRequestPayload, ELResponse} from "./types.js";
import {isEIP1193Provider, isRequestProvider, isSendAsyncProvider, isSendProvider} from "./utils/assertion.js";
import {processVerifiedELRequest} from "./utils/execution.js";

type ProvableProviderInitOpts = {network?: NetworkName; checkpoint?: string} & (
  | {mode: LightNode.Rest; urls: string[]}
  | {mode: LightNode.P2P; bootnodes: string[]}
);

const defaultNetwork = "mainnet";

export function makeProvableProvider<T extends Web3Provider>(
  provider: T,
  opts: ProvableProviderInitOpts
): T & {rootProvider: ProofProvider} {
  const controller = new AbortController();
  const rootProvider =
    opts.mode === LightNode.Rest
      ? ProofProvider.buildWithRestApi(opts.urls, {
          network: opts.network ?? defaultNetwork,
          signal: controller.signal,
        })
      : // Implement other mode
        ProofProvider.buildWithRestApi(opts.bootnodes, {
          network: opts.network ?? defaultNetwork,
          signal: controller.signal,
        });

  if (isSendProvider(provider)) {
    return Object.assign(handleSendProvider(provider, rootProvider) as T, {rootProvider});
  }

  if (isRequestProvider(provider)) {
    return Object.assign(handleRequestProvider(provider, rootProvider) as T, {rootProvider});
  }

  if (isSendAsyncProvider(provider)) {
    return Object.assign(handleSendAsyncProvider(provider, rootProvider) as T, {rootProvider});
  }

  if (isEIP1193Provider(provider)) {
    return Object.assign(handleEIP1193Provider(provider, rootProvider) as T, {rootProvider});
  }

  return Object.assign(provider, {rootProvider});
}

function handleSendProvider(provider: SendProvider, rootProvider: ProofProvider): SendProvider {
  const send = provider.send.bind(provider);
  const handler = (payload: ELRequestPayload): Promise<ELResponse | undefined> =>
    new Promise((resolve, reject) => {
      send(payload, (err, response) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    });

  function newSend(payload: ELRequestPayload, callback: (err?: Error | null, response?: ELResponse) => void): void {
    processVerifiedELRequest({payload, handler, rootProvider})
      .then((response) => callback(undefined, response))
      .catch((err) => callback(err, undefined));
  }

  return Object.assign(provider, {send: newSend});
}

function handleRequestProvider(provider: RequestProvider, rootProvider: ProofProvider): RequestProvider {
  const request = provider.request.bind(provider);
  const handler = (payload: ELRequestPayload): Promise<ELResponse | undefined> =>
    new Promise((resolve, reject) => {
      request(payload, (err, response) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    });

  function newRequest(payload: ELRequestPayload, callback: (err?: Error | null, response?: ELResponse) => void): void {
    processVerifiedELRequest({payload, handler, rootProvider})
      .then((response) => callback(undefined, response))
      .catch((err) => callback(err, undefined));
  }

  return Object.assign(provider, {request: newRequest});
}

function handleSendAsyncProvider(provider: SendAsyncProvider, rootProvider: ProofProvider): SendAsyncProvider {
  const sendAsync = provider.sendAsync.bind(provider);
  const handler = (payload: ELRequestPayload): Promise<ELResponse | undefined> => sendAsync(payload);

  async function newSendAsync(payload: ELRequestPayload): Promise<ELResponse | undefined> {
    return processVerifiedELRequest({payload, handler, rootProvider});
  }

  return Object.assign(provider, {sendAsync: newSendAsync});
}

function handleEIP1193Provider(provider: EIP1193Provider, rootProvider: ProofProvider): EIP1193Provider {
  const request = provider.request.bind(provider);
  const handler = (payload: ELRequestPayload): Promise<ELResponse | undefined> => request(payload);

  async function newRequest(payload: ELRequestPayload): Promise<ELResponse | undefined> {
    return processVerifiedELRequest({payload, handler, rootProvider});
  }

  return Object.assign(provider, {request: newRequest});
}
