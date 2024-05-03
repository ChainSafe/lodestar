import {Web3ProviderType} from "../interfaces.js";
import {JsonRpcRequestOrBatch, JsonRpcResponse, JsonRpcResponseOrBatch} from "../types.js";
import {isBatchRequest} from "../utils/json_rpc.js";
import web3JsProviderType from "./web3_js_provider_type.js";

export interface EthersProvider {
  // Ethers provider does not have a public interface for batch requests
  send(method: string, params: Array<unknown>): Promise<JsonRpcResponse>;
}
export default {
  name: "ethers",
  matched(provider): provider is EthersProvider {
    return (
      !web3JsProviderType.matched(provider) &&
      "send" in provider &&
      typeof provider.send === "function" &&
      provider.send.length > 1 &&
      provider.send.constructor.name === "AsyncFunction"
    );
  },
  handler(provider) {
    const send = provider.send.bind(provider);

    return async (payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> => {
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
  },
  mutateProvider(provider, newHandler) {
    Object.assign(provider, {
      send: function newSend(method: string, params: Array<unknown>): Promise<JsonRpcResponseOrBatch | undefined> {
        return newHandler({jsonrpc: "2.0", id: 0, method, params});
      },
    });
  },
} as Web3ProviderType<EthersProvider>;
