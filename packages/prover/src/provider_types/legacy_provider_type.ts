import {AnyWeb3Provider, Web3ProviderType} from "../interfaces.js";
import {JsonRpcRequest, JsonRpcRequestOrBatch, JsonRpcResponse, JsonRpcResponseOrBatch} from "../types.js";
import web3JsProviderType from "./web3_js_provider_type.js";

// Some providers uses `request` instead of the `send`. e.g. Ganache
interface RequestProvider {
  request(
    payload: JsonRpcRequestOrBatch,
    callback: (err: Error | undefined, response: JsonRpcResponseOrBatch) => void
  ): void;
}
// The legacy Web3 1.x use this structure
interface SendProvider {
  send(payload: JsonRpcRequest, callback: (err?: Error | null, response?: JsonRpcResponse) => void): void;
}
// Some legacy providers use this very old structure
interface SendAsyncProvider {
  sendAsync(payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch>;
}

type LegacyProvider = RequestProvider | SendProvider | SendAsyncProvider;

export default {
  name: "legacy",
  matched(provider): provider is LegacyProvider {
    return isRequestProvider(provider) || isSendProvider(provider) || isSendAsyncProvider(provider);
  },
  handler(provider) {
    if (isRequestProvider(provider)) {
      const request = provider.request.bind(provider);
      return function newHandler(payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> {
        return new Promise((resolve, reject) => {
          request(payload, (err, response) => {
            if (err) {
              reject(err);
            } else {
              resolve(response);
            }
          });
        });
      };
    }
    if (isSendProvider(provider)) {
      const send = provider.send.bind(provider);
      return function newHandler(payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> {
        return new Promise((resolve, reject) => {
          // web3 providers supports batch requests but don't have valid types
          send(payload as JsonRpcRequest, (err, response) => {
            if (err) {
              reject(err);
            } else {
              resolve(response);
            }
          });
        });
      };
    }

    // sendAsync provider
    const sendAsync = provider.sendAsync.bind(provider);
    return async function newHandler(payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> {
      const response = await sendAsync(payload);
      return response;
    };
  },
  mutateProvider(provider, newHandler) {
    if (isRequestProvider(provider)) {
      const newRequest = function newRequest(
        payload: JsonRpcRequestOrBatch,
        callback: (err?: Error | null, response?: JsonRpcResponseOrBatch) => void
      ): void {
        newHandler(payload)
          .then((response) => callback(undefined, response))
          .catch((err) => callback(err, undefined));
      };

      Object.assign(provider, {request: newRequest});
    }

    if (isSendProvider(provider)) {
      const newSend = function newSend(
        payload: JsonRpcRequestOrBatch,
        callback: (err?: Error | null, response?: JsonRpcResponseOrBatch) => void
      ): void {
        newHandler(payload)
          .then((response) => callback(undefined, response))
          .catch((err) => callback(err, undefined));
      };

      Object.assign(provider, {send: newSend});
    }

    // sendAsync provider
    Object.assign(provider, {sendAsync: newHandler});
  },
} as Web3ProviderType<LegacyProvider>;

function isSendProvider(provider: AnyWeb3Provider): provider is SendProvider {
  return (
    !web3JsProviderType.matched(provider) &&
    "send" in provider &&
    typeof provider.send === "function" &&
    provider.send.length > 1 &&
    provider.send.constructor.name !== "AsyncFunction"
  );
}

function isRequestProvider(provider: AnyWeb3Provider): provider is RequestProvider {
  return (
    !web3JsProviderType.matched(provider) &&
    "request" in provider &&
    typeof provider.request === "function" &&
    provider.request.length > 1
  );
}

function isSendAsyncProvider(provider: AnyWeb3Provider): provider is SendAsyncProvider {
  return (
    "sendAsync" in provider &&
    typeof provider.sendAsync === "function" &&
    provider.sendAsync.constructor.name === "AsyncFunction"
  );
}
