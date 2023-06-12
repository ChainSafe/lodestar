import {Common, CustomChain, Hardfork} from "@ethereumjs/common";
import {Logger} from "@lodestar/logger";
import {ELRequestHandler} from "../interfaces.js";
import {
  ELApi,
  ELApiParams,
  ELApiReturn,
  ELTransaction,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcResponseWithResultPayload,
  JsonRpcBatchRequest,
  JsonRpcBatchResponse,
} from "../types.js";
import {
  isRequest,
  isValidBatchResponse,
  isValidResponse,
  logRequest,
  logResponse,
  mergeBatchReqResp,
} from "./json_rpc.js";
import {isBlockNumber, isNullish, isPresent} from "./validation.js";

export type Optional<T, K extends keyof T> = Omit<T, K> & {[P in keyof T]?: T[P] | undefined};

export class ELRpc {
  private handler: ELRequestHandler;
  private logger: Logger;

  constructor(handler: ELRequestHandler, logger: Logger) {
    this.handler = handler;
    this.logger = logger;
  }

  async request<K extends keyof ELApi, E extends boolean>(
    method: K,
    params: ELApiParams[K],
    opts: {raiseError: E}
  ): Promise<E extends false ? JsonRpcResponse<ELApiReturn[K]> : JsonRpcResponseWithResultPayload<ELApiReturn[K]>> {
    const {raiseError} = opts;

    const payload: JsonRpcRequest = {jsonrpc: "2.0", method, params, id: this.getRequestId()};
    logRequest(payload, this.logger);

    const response = await this.handler(payload);
    logResponse(response, this.logger);

    if (raiseError && !isValidResponse(response)) {
      throw new Error(`Invalid response from RPC. method=${method} params=${JSON.stringify(params)}`);
    }

    return response as JsonRpcResponseWithResultPayload<ELApiReturn[K]>;
  }

  async batchRequest<E extends boolean>(
    input: JsonRpcBatchRequest,
    opts: {raiseError: E}
  ): Promise<
    E extends false
      ? {request: JsonRpcRequest; response: JsonRpcResponse}[]
      : {request: JsonRpcRequest; response: JsonRpcResponseWithResultPayload<unknown>}[]
  > {
    const payloads: JsonRpcBatchRequest = [];

    for (const req of input) {
      if (isRequest(req) && isNullish(req.id)) {
        payloads.push({jsonrpc: "2.0", method: req.method, params: req.params, id: this.getRequestId()});
      } else {
        payloads.push(req);
      }
    }

    logRequest(payloads, this.logger);
    const response = await this.handler(payloads);
    logResponse(response, this.logger);

    if (isNullish(response)) {
      throw new Error("Invalid empty response from server.");
    }

    if (opts.raiseError && !isValidBatchResponse(payloads, response as JsonRpcBatchResponse)) {
      throw new Error(
        `Invalid response from RPC. payload=${JSON.stringify(payloads)} response=${JSON.stringify(response)}}`
      );
    }

    return mergeBatchReqResp(payloads, response as JsonRpcBatchResponse) as E extends false
      ? {request: JsonRpcRequest; response: JsonRpcResponse}[]
      : {request: JsonRpcRequest; response: JsonRpcResponseWithResultPayload<unknown>}[];
  }

  private getRequestId(): string {
    // TODO: Find better way to generate random id
    return (Math.random() * 10000).toFixed(0);
  }
}

export async function getELCode(rpc: ELRpc, args: ELApiParams["eth_getCode"]): Promise<ELApiReturn["eth_getCode"]> {
  const codeResult = await rpc.request("eth_getCode", args, {raiseError: false});

  if (!isValidResponse(codeResult)) {
    throw new Error(`Can not find code for address=${args[0]}`);
  }

  return codeResult.result;
}

export async function getELProof(rpc: ELRpc, args: ELApiParams["eth_getProof"]): Promise<ELApiReturn["eth_getProof"]> {
  const proof = await rpc.request("eth_getProof", args, {raiseError: false});
  if (!isValidResponse(proof)) {
    throw new Error(`Can not find proof for address=${args[0]}`);
  }
  return proof.result;
}

export async function getELBlock(
  rpc: ELRpc,
  args: ELApiParams["eth_getBlockByNumber"]
): Promise<ELApiReturn["eth_getBlockByNumber"]> {
  const block = await rpc.request(isBlockNumber(args[0]) ? "eth_getBlockByNumber" : "eth_getBlockByHash", args, {
    raiseError: false,
  });

  if (!isValidResponse(block)) {
    throw new Error(`Can not find block. id=${args[0]}`);
  }

  return block.result;
}

export function getChainCommon(network: string): Common {
  switch (network) {
    case "mainnet":
    case "goerli":
    case "ropsten":
    case "sepolia":
      // TODO: Not sure how to detect the fork during runtime
      return new Common({chain: network, hardfork: Hardfork.Shanghai});
    case "minimal":
      // TODO: Not sure how to detect the fork during runtime
      return new Common({chain: "mainnet", hardfork: Hardfork.Shanghai});
    case "gnosis":
      return new Common({chain: CustomChain.xDaiChain});
    default:
      throw new Error(`Non supported network "${network}"`);
  }
}

export function getTxType(tx: ELTransaction): number {
  if (isPresent(tx.maxFeePerGas) || isPresent(tx.maxPriorityFeePerGas)) {
    return 2;
  }

  if (isPresent(tx.accessList)) {
    return 1;
  }

  return 0;
}
