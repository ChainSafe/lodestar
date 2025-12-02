import {AnyWeb3Provider, Web3ProviderType} from "../interfaces.js";
import {JsonRpcRequest, JsonRpcRequestOrBatch, JsonRpcResponse, JsonRpcResponseOrBatch} from "../types.js";
import {isBatchRequest} from "../utils/json_rpc.js";

export interface Web3jsProvider {
  request: (payload: JsonRpcRequest) => Promise<JsonRpcResponse>;
}

export default {
  name: "web3js",
  matched(provider): provider is Web3jsProvider {
    return (
      "isWeb3Provider" in provider.constructor &&
      (provider.constructor as {isWeb3Provider: (provider: AnyWeb3Provider) => boolean}).isWeb3Provider(provider)
    );
  },
  handler(provider) {
    const request = provider.request.bind(provider);

    return async (payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> => {
      if (isBatchRequest(payload)) {
        return Promise.all(payload.map((p) => request(p)));
      }

      return request(payload);
    };
  },
  mutateProvider(provider, newHandler) {
    Object.assign(provider, {
      request: async function newRequest(payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> {
        return newHandler(payload);
      },
    });
  },
} as Web3ProviderType<Web3jsProvider>;
