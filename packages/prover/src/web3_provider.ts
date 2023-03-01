import {NetworkName} from "@lodestar/config/networks";
import {LightNode, SendProvider, Web3Provider} from "./interfaces.js";
import {RootProvider} from "./root_provider/root_provider.js";
import {ELRequestPayload, ELResponse} from "./types.js";
import {isSendProvider} from "./utils.js";
import {verifyWeb3Response} from "./verifier.js";

type ProvableProviderInitOpts = {network?: NetworkName; checkpoint?: string} & (
  | {mode: LightNode.Rest; urls: string[]}
  | {mode: LightNode.P2P; bootnodes: string[]}
);

const defaultNetwork = "mainnet";

export async function makeProvableProvider<T extends Web3Provider>(
  provider: T,
  opts: ProvableProviderInitOpts
): Promise<T & {rootProvider: RootProvider}> {
  const controller = new AbortController();
  const rootProvider =
    opts.mode === LightNode.Rest
      ? await RootProvider.initWithRestApi(opts.urls, {
          network: opts.network ?? defaultNetwork,
          signal: controller.signal,
          checkpoint: opts.checkpoint,
        })
      : await RootProvider.initWithBootNodes(opts.bootnodes, {
          network: opts.network ?? defaultNetwork,
          signal: controller.signal,
        });

  if (isSendProvider(provider)) {
    return Object.assign(handleSendProvider(provider, rootProvider) as T, {rootProvider});
  }

  return Object.assign(provider, {rootProvider});
}

function handleSendProvider(provider: SendProvider, rootProvider: RootProvider): SendProvider {
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
    handler(payload)
      .then((response) => verifyWeb3Response({payload, response, handler, rootProvider}))
      .then((response) => callback(undefined, response))
      .catch((err) => callback(err, undefined));
  }

  return Object.assign(provider, {send: newSend});
}
