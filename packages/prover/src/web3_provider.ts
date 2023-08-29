import {Logger} from "@lodestar/utils";
import {getBrowserLogger} from "@lodestar/logger/browser";
import {LogLevel} from "@lodestar/logger";
import {
  EIP1193Provider,
  EthersProvider,
  RequestProvider,
  SendAsyncProvider,
  SendProvider,
  VerifiedExecutionInitOptions,
  Web3Provider,
} from "./interfaces.js";
import {ProofProvider} from "./proof_provider/proof_provider.js";
import {JsonRpcRequest, JsonRpcRequestOrBatch, JsonRpcResponseOrBatch} from "./types.js";
import {
  isEIP1193Provider,
  isEthersProvider,
  isRequestProvider,
  isSendAsyncProvider,
  isSendProvider,
  isWeb3jsProvider,
} from "./utils/assertion.js";
import {processAndVerifyRequest} from "./utils/process.js";
import {isBatchRequest} from "./utils/json_rpc.js";
import {ELRpc} from "./utils/rpc.js";

export type Web3ProviderTypeHandler<T extends Web3Provider> = (
  provider: T,
  proofProvider: ProofProvider,
  logger: Logger
) => {provider: T; rpc: ELRpc};

export function createVerifiedExecutionProvider<T extends Web3Provider>(
  provider: T,
  opts: VerifiedExecutionInitOptions
): {provider: T; proofProvider: ProofProvider} {
  const signal = opts.signal ?? new AbortController().signal;
  const logger = opts.logger ?? getBrowserLogger({level: opts.logLevel ?? LogLevel.info});

  const proofProvider = ProofProvider.init({
    ...opts,
    signal,
    logger,
  });

  const handler = getProviderTypeHandler(provider, logger);
  const {provider: newInstance, rpc} = handler(provider, proofProvider, logger);

  rpc.verifyCompatibility().catch((err) => {
    logger.error(err);
    logger.error("Due to compatibility issues, verified execution may not work properly.");
  });

  return {provider: newInstance, proofProvider: proofProvider};
}

function handleSendProvider(
  provider: SendProvider,
  proofProvider: ProofProvider,
  logger: Logger
): {provider: SendProvider; rpc: ELRpc} {
  const send = provider.send.bind(provider);
  const handler = (payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> =>
    new Promise((resolve, reject) => {
      // web3 providers supports batch requests but don't have valid types
      send(payload as JsonRpcRequest, (err, response) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
  const rpc = new ELRpc(handler, logger);

  function newSend(
    payload: JsonRpcRequestOrBatch,
    callback: (err?: Error | null, response?: JsonRpcResponseOrBatch) => void
  ): void {
    processAndVerifyRequest({payload, rpc, proofProvider, logger})
      .then((response) => callback(undefined, response))
      .catch((err) => callback(err, undefined));
  }

  return {provider: Object.assign(provider, {send: newSend}), rpc};
}

function handleRequestProvider(
  provider: RequestProvider,
  proofProvider: ProofProvider,
  logger: Logger
): {provider: RequestProvider; rpc: ELRpc} {
  const request = provider.request.bind(provider);
  const handler = (payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> =>
    new Promise((resolve, reject) => {
      request(payload, (err, response) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
  const rpc = new ELRpc(handler, logger);

  function newRequest(
    payload: JsonRpcRequestOrBatch,
    callback: (err?: Error | null, response?: JsonRpcResponseOrBatch) => void
  ): void {
    processAndVerifyRequest({payload, rpc, proofProvider, logger})
      .then((response) => callback(undefined, response))
      .catch((err) => callback(err, undefined));
  }

  return {provider: Object.assign(provider, {request: newRequest}), rpc};
}

function handleSendAsyncProvider(
  provider: SendAsyncProvider,
  proofProvider: ProofProvider,
  logger: Logger
): {provider: SendAsyncProvider; rpc: ELRpc} {
  const sendAsync = provider.sendAsync.bind(provider);
  const handler = async (payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> => {
    const response = await sendAsync(payload);
    return response;
  };
  const rpc = new ELRpc(handler, logger);

  async function newSendAsync(payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> {
    return processAndVerifyRequest({payload, rpc, proofProvider, logger});
  }

  return {provider: Object.assign(provider, {sendAsync: newSendAsync}), rpc};
}

function handleEIP1193Provider(
  provider: EIP1193Provider,
  proofProvider: ProofProvider,
  logger: Logger
): {provider: EIP1193Provider; rpc: ELRpc} {
  const request = provider.request.bind(provider);
  const handler = async (payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> => {
    const response = await request(payload);
    return response;
  };
  const rpc = new ELRpc(handler, logger);

  async function newRequest(payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> {
    return processAndVerifyRequest({payload, rpc, proofProvider, logger});
  }

  return {provider: Object.assign(provider, {request: newRequest}), rpc};
}

function handleEthersProvider(
  provider: EthersProvider,
  proofProvider: ProofProvider,
  logger: Logger
): {provider: EthersProvider; rpc: ELRpc} {
  const send = provider.send.bind(provider);
  const handler = async (payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> => {
    // Because ethers provider public interface does not support batch requests
    // so we need to handle it manually
    if (isBatchRequest(payload)) {
      const responses = [];
      for (const request of payload) {
        responses.push(await send(request.method, request.params));
      }
      return responses;
    }

    return send(payload.method, payload.params);
  };
  const rpc = new ELRpc(handler, logger);

  async function newSend(method: string, params: Array<unknown>): Promise<JsonRpcResponseOrBatch | undefined> {
    return processAndVerifyRequest({
      payload: {jsonrpc: "2.0", id: 0, method, params},
      rpc,
      proofProvider,
      logger,
    });
  }

  return {provider: Object.assign(provider, {send: newSend}), rpc};
}
/**
 *
 *
 * @export
 * @template T
 * @param {T} provider
 * @param {Logger} logger
 * @return {*}  {Web3ProviderTypeHandler<T>}
 */
export function getProviderTypeHandler<T extends Web3Provider>(
  provider: T,
  logger: Logger
): Web3ProviderTypeHandler<T> {
  if (isWeb3jsProvider(provider)) {
    logger.debug("Provider is recognized as 'web3.js' provider.");
    // EIP-1193 provider is fully compatible with web3.js#4x provider interface
    return handleEIP1193Provider as unknown as Web3ProviderTypeHandler<T>;
  }

  if (isEthersProvider(provider)) {
    logger.debug("Provider is recognized as 'ethers' provider.");
    return handleEthersProvider as unknown as Web3ProviderTypeHandler<T>;
  }

  if (isEIP1193Provider(provider)) {
    logger.debug("Provider is recognized as 'EIP1193' provider.");
    return handleEIP1193Provider as unknown as Web3ProviderTypeHandler<T>;
  }

  if (isSendProvider(provider)) {
    logger.debug("Provider is recognized as legacy provider with 'send' method.");
    return handleSendProvider as unknown as Web3ProviderTypeHandler<T>;
  }

  if (isRequestProvider(provider)) {
    logger.debug("Provider is recognized as legacy provider with 'request' method.");
    return handleRequestProvider as unknown as Web3ProviderTypeHandler<T>;
  }

  if (isSendAsyncProvider(provider)) {
    logger.debug("Provider is recognized as legacy provider with 'sendAsync' method.");
    return handleSendAsyncProvider as unknown as Web3ProviderTypeHandler<T>;
  }

  throw new Error("Unsupported provider type");
}
