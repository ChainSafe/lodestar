import {ELRequestHandler} from "../../src/interfaces.js";
import {ELProof} from "../../src/types.js";

export function createELRequestHandlerMock({accountProof}: {accountProof: ELProof}): ELRequestHandler {
  return async function handler(payload) {
    if (payload.method === "eth_getProof") {
      return {
        jsonrpc: "2.0",
        id: payload.id,
        result: accountProof,
      };
    }

    return {jsonrpc: "2.0", id: payload.id, result: null};
  };
}
