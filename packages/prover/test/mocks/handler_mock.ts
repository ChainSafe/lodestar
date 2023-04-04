import {ELRequestHandler} from "../../src/interfaces.js";
import {ELBlock, ELProof} from "../../src/types.js";

export function createELRequestHandlerMock<P = unknown, R = unknown>({
  accountProof,
  block,
}: {
  accountProof?: ELProof;
  block?: ELBlock;
}): ELRequestHandler<P, R> {
  return async function handler(payload) {
    if (payload.method === "eth_getProof" && accountProof) {
      return {
        jsonrpc: "2.0",
        id: payload.id,
        result: accountProof,
      };
    }

    if ((payload.method === "eth_getBlockByHash" || payload.method === "eth_getBlockByNumber") && block) {
      return {
        jsonrpc: "2.0",
        id: payload.id,
        result: block,
      };
    }

    return {jsonrpc: "2.0", id: payload.id, result: null};
  } as ELRequestHandler<P, R>;
}
