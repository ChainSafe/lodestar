import {NetworkName} from "@lodestar/config/networks";
import {Logger} from "@lodestar/utils";
import {
  ConsensusNodeOptions,
  EIP1193Provider,
  EthersProvider,
  LogOptions,
  RequestProvider,
  SendAsyncProvider,
  SendProvider,
  Web3Provider,
} from "./interfaces.js";
import {ProofProvider} from "./proof_provider/proof_provider.js";
import {ELRequestPayload, ELResponse} from "./types.js";
import {
  isEIP1193Provider,
  isEthersProvider,
  isRequestProvider,
  isSendAsyncProvider,
  isSendProvider,
} from "./utils/assertion.js";
import {getLogger} from "./utils/logger.js";
import {processAndVerifyRequest} from "./utils/process.js";

type ProvableProviderInitOpts = {network?: NetworkName; wsCheckpoint?: string; signal?: AbortSignal} & LogOptions &
  ConsensusNodeOptions;

const defaultNetwork = "mainnet";

export function createVerifiedExecutionProvider<T extends Web3Provider>(
  provider: T,
  opts: ProvableProviderInitOpts
): {provider: T; proofProvider: ProofProvider} {
  const signal = opts.signal ?? new AbortController().signal;
  const logger = getLogger(opts);
  const proofProvider = ProofProvider.init({
    ...opts,
    network: opts.network ?? defaultNetwork,
    signal,
    logger,
  });

  if (isSendProvider(provider)) {
    logger.debug("Creating a provider which is recognized as legacy provider with 'send' method.");
    return {provider: handleSendProvider(provider, proofProvider, logger) as T, proofProvider};
  }

  if (isEthersProvider(provider)) {
    logger.debug("Creating a provider which is recognized as 'ethers' provider.");
    return {provider: handleEthersProvider(provider, proofProvider, logger) as T, proofProvider};
  }

  if (isRequestProvider(provider)) {
    logger.debug("Creating a provider which is recognized as legacy provider with 'request' method.");
    return {provider: handleRequestProvider(provider, proofProvider, logger) as T, proofProvider};
  }

  if (isSendAsyncProvider(provider)) {
    logger.debug("Creating a provider which is recognized as legacy provider with 'sendAsync' method.");
    return {provider: handleSendAsyncProvider(provider, proofProvider, logger) as T, proofProvider};
  }

  if (isEIP1193Provider(provider)) {
    logger.debug("Creating a provider which is recognized as 'EIP1193' provider.");
    return {provider: handleEIP1193Provider(provider, proofProvider, logger) as T, proofProvider};
  }

  return {provider, proofProvider: proofProvider};
}

function handleSendProvider(provider: SendProvider, proofProvider: ProofProvider, logger: Logger): SendProvider {
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
    processAndVerifyRequest({payload, handler, proofProvider, logger})
      .then((response) => callback(undefined, response))
      .catch((err) => callback(err, undefined));
  }

  return Object.assign(provider, {send: newSend});
}

function handleRequestProvider(
  provider: RequestProvider,
  proofProvider: ProofProvider,
  logger: Logger
): RequestProvider {
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
    processAndVerifyRequest({payload, handler, proofProvider, logger})
      .then((response) => callback(undefined, response))
      .catch((err) => callback(err, undefined));
  }

  return Object.assign(provider, {request: newRequest});
}

function handleSendAsyncProvider(
  provider: SendAsyncProvider,
  proofProvider: ProofProvider,
  logger: Logger
): SendAsyncProvider {
  const sendAsync = provider.sendAsync.bind(provider);
  const handler = (payload: ELRequestPayload): Promise<ELResponse | undefined> => sendAsync(payload);

  async function newSendAsync(payload: ELRequestPayload): Promise<ELResponse | undefined> {
    return processAndVerifyRequest({payload, handler, proofProvider, logger});
  }

  return Object.assign(provider, {sendAsync: newSendAsync});
}

function handleEIP1193Provider(
  provider: EIP1193Provider,
  proofProvider: ProofProvider,
  logger: Logger
): EIP1193Provider {
  const request = provider.request.bind(provider);
  const handler = (payload: ELRequestPayload): Promise<ELResponse | undefined> => request(payload);

  async function newRequest(payload: ELRequestPayload): Promise<ELResponse | undefined> {
    return processAndVerifyRequest({payload, handler, proofProvider, logger});
  }

  return Object.assign(provider, {request: newRequest});
}

function handleEthersProvider(provider: EthersProvider, proofProvider: ProofProvider, logger: Logger): EthersProvider {
  const send = provider.send.bind(provider);
  const handler = (payload: ELRequestPayload): Promise<ELResponse | undefined> => send(payload.method, payload.params);

  async function newSend(method: string, params: Array<unknown>): Promise<ELResponse | undefined> {
    return processAndVerifyRequest({
      payload: {jsonrpc: "2.0", id: 0, method, params},
      handler,
      proofProvider,
      logger,
    });
  }

  return Object.assign(provider, {send: newSend});
}
