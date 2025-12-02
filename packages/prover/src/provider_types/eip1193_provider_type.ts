import {Web3ProviderType} from "../interfaces.js";
import {JsonRpcRequestOrBatch, JsonRpcResponseOrBatch} from "../types.js";

// Modern providers uses this structure e.g. Web3 4.x
export interface EIP1193Provider {
  request: (payload: JsonRpcRequestOrBatch) => Promise<JsonRpcResponseOrBatch>;
}
export default {
  name: "eip1193",
  matched(provider): provider is EIP1193Provider {
    return (
      "request" in provider &&
      typeof provider.request === "function" &&
      provider.request.constructor.name === "AsyncFunction"
    );
  },
  handler(provider) {
    const request = provider.request.bind(provider);

    return async (payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> => {
      const response = await request(payload);
      return response;
    };
  },
  mutateProvider(provider, newHandler) {
    Object.assign(provider, {
      request: async function newRequest(payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> {
        return newHandler(payload);
      },
    });
  },
} as Web3ProviderType<EIP1193Provider>;
