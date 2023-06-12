import http from "node:http";
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
  JsonRpcRequestOrBatch,
  JsonRpcResponse,
  JsonRpcResponseOrBatch,
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
import {fetchResponseBody} from "./req_resp.js";

export type Optional<T, K extends keyof T> = Omit<T, K> & {[P in keyof T]?: T[P] | undefined};

export class ELRpc {
  private handler: ELRequestHandler;
  private logger: Logger;
  private isCompatible?: boolean;

  constructor(handler: ELRequestHandler, logger: Logger) {
    this.handler = handler;
    this.logger = logger;
  }

  async request<K extends keyof ELApi, E extends boolean>(
    method: K,
    params: ELApiParams[K],
    opts: {raiseError: E}
  ): Promise<E extends false ? JsonRpcResponse<ELApiReturn[K]> : JsonRpcResponseWithResultPayload<ELApiReturn[K]>> {
    await this.verifyCompatibility();
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
    await this.verifyCompatibility();
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
    if (isNullish(this.isCompatible)) {
      try {
        await this.request("eth_getProof", [ZERO_ADDRESS, [], "latest"], {raiseError: true});
        this.isCompatible = true;
      } catch {
        this.isCompatible = false;
      }
    }

    if (!this.isCompatible) {
      throw new Error("RPC does not support 'eth_getProof', which is required for the prover to work properly.");
    }
  }

  private getRequestId(): string {
    // TODO: Find better way to generate random id
    return (Math.random() * 10000).toFixed(0);
  }
}

export function createHttpHandler({
  info,
  signal,
}: {
  signal: AbortSignal;
  info: () => {port: number; host: string; timeout: number} | string;
}): ELRequestHandler {
  return function handler(payload: JsonRpcRequestOrBatch): Promise<JsonRpcResponseOrBatch | undefined> {
    return new Promise((resolve, reject) => {
      const serverInfo = info();
      if (typeof serverInfo === "string") {
        return reject(new Error(serverInfo));
      }

      const req = http.request(
        {
          method: "POST",
          path: "/proxy",
          port: serverInfo.port,
          host: serverInfo.host,
          timeout: serverInfo.timeout,
          signal,
          headers: {
            "Content-Type": "application/json",
          },
        },
        (res) => {
          fetchResponseBody(res)
            .then((response) => {
              resolve(response);
            })
            .catch(reject);
        }
      );
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
      req.write(JSON.stringify(payload));
      req.end();
    });
  };
}
