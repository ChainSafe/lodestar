import {Logger} from "@lodestar/logger";
import {ZERO_ADDRESS} from "../constants.js";
import {ELRequestHandler} from "../interfaces.js";
import {
  ELApi,
  ELApiParams,
  ELApiReturn,
  JsonRpcBatchRequest,
  JsonRpcBatchResponse,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcResponseWithResultPayload,
} from "../types.js";
import {
  isRequest,
  isValidBatchResponse,
  isValidResponse,
  logRequest,
  logResponse,
  mergeBatchReqResp,
} from "./json_rpc.js";
import {isNullish} from "./validation.js";

export type Optional<T, K extends keyof T> = Omit<T, K> & {[P in keyof T]?: T[P] | undefined};

export class ELRpc {
  private handler: ELRequestHandler;
  private logger: Logger;

  private requestId = 0;

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

  async verifyCompatibility(): Promise<void> {
    try {
      await this.request("eth_getProof", [ZERO_ADDRESS, [], "latest"], {raiseError: true});
    } catch (err) {
      this.logger.error("Execution compatibility failed.", undefined, err as Error);
      throw new Error("RPC does not support 'eth_getProof', which is required for the prover to work properly.");
    }
  }

  getRequestId(): string {
    return (++this.requestId).toString();
  }
}
