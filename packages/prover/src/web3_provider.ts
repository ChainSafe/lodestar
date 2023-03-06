import {NetworkName} from "@lodestar/config/networks";
import {LightNode, SendProvider, Web3Provider} from "./interfaces.js";
import {ProofProvider} from "./proof_provider/proof_provider.js";
import {ELRequestPayload, ELResponse} from "./types.js";
import {isSendProvider} from "./utils/assertion.js";
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
