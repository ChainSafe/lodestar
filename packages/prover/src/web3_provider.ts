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
import {JsonRpcRequestOrBatch, JsonRpcResponseOrBatch} from "./types.js";
import {
  isEIP1193Provider,
  isEthersProvider,
  isRequestProvider,
  isSendAsyncProvider,
  isSendProvider,
} from "./utils/assertion.js";
import {processAndVerifyRequest} from "./utils/process.js";
import {isBatchRequest} from "./utils/json_rpc.js";
import {ELRpc} from "./utils/execution.js";

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
  const handler = (payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> =>
    new Promise((resolve, reject) => {
      if (isBatchRequest(payload)) {
        throw new Error("The provider public interface does not support batch requests.");
      }

      send(payload, (err, response) => {
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

  return Object.assign(provider, {send: newSend});
}

function handleRequestProvider(
  provider: RequestProvider,
  proofProvider: ProofProvider,
  logger: Logger
): RequestProvider {
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

  return Object.assign(provider, {request: newRequest});
}

function handleSendAsyncProvider(
  provider: SendAsyncProvider,
  proofProvider: ProofProvider,
  logger: Logger
): SendAsyncProvider {
  const sendAsync = provider.sendAsync.bind(provider);
  const handler = async (payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> => {
    const response = await sendAsync(payload);
    return response;
  };
  const rpc = new ELRpc(handler, logger);

  async function newSendAsync(payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> {
    return processAndVerifyRequest({payload, rpc, proofProvider, logger});
  }

  return Object.assign(provider, {sendAsync: newSendAsync});
}

function handleEIP1193Provider(
  provider: EIP1193Provider,
  proofProvider: ProofProvider,
  logger: Logger
): EIP1193Provider {
  const request = provider.request.bind(provider);
  const handler = async (payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> => {
    const response = await request(payload);
    return response;
  };
  const rpc = new ELRpc(handler, logger);

  async function newRequest(payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> {
    return processAndVerifyRequest({payload, rpc, proofProvider, logger});
  }

  return Object.assign(provider, {request: newRequest});
}

function handleEthersProvider(provider: EthersProvider, proofProvider: ProofProvider, logger: Logger): EthersProvider {
  const send = provider.send.bind(provider);
  const handler = async (payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> => {
    if (isBatchRequest(payload)) {
      throw new Error("Ethers provider public interface does not support batch requests.");
    }

    const response = await send(payload.method, payload.params);

    return response;
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

  return Object.assign(provider, {send: newSend});
}
