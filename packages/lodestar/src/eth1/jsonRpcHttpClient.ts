// Uses isomorphic-fetch for browser + NodeJS cross compatibility
import fetch from "isomorphic-fetch";
import {AbortSignal} from "abort-controller";
import {IJsonRpcClient, IRpcPayload} from "./interface";

interface IRpcResponse<R> {
  jsonrpc: "2.0";
  id: number;
  result?: R;
  error?: {
    code: number; // -32601;
    message: string; // "The method eth_none does not exist/is not available"
  };
}

export class JsonRpcHttpClient implements IJsonRpcClient {
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Perform RPC request
   */
  async fetch<R>({method, params}: IRpcPayload, signal?: AbortSignal): Promise<R> {
    const res: IRpcResponse<R> = await fetchJson(this.url, {jsonrpc: "2.0", method, params, id: 1}, signal);
    return parseRpcResponse(res);
  }

  /**
   * Perform RPC batched request
   * Type-wise assumes all requests results have the same type
   */
  async fetchBatch<R>(rpcPayloadArr: IRpcPayload[], signal?: AbortSignal): Promise<R[]> {
    if (rpcPayloadArr.length === 0) return [];

    const resArr: IRpcResponse<R>[] = await fetchJson(
      this.url,
      rpcPayloadArr.map(({method, params}, i) => ({jsonrpc: "2.0", method, params, id: i})),
      signal
    );
    return resArr.map(parseRpcResponse);
  }
}

function parseRpcResponse<R>(res: IRpcResponse<R>): R {
  if (res.error) {
    if (typeof res.error.message === "string") {
      throw Error(res.error.message);
    } else if (res.error.code) {
      throw Error(`JSON RPC error ${res.error.code}`);
    }
    throw Error("JSON RPC error");
  } else if (res.result === undefined) {
    throw Error("No JSON RPC result");
  } else {
    return res.result;
  }
}

/**
 * Limits the amount of response text printed with RPC or parsing errors
 */
const maxStringLengthToPrint = 500;

/**
 * Fetches JSON and throws detailed errors in case the HTTP request is not ok
 */
async function fetchJson<R, T = unknown>(url: string, json: T, signal?: AbortSignal): Promise<R> {
  const res = await fetch(url, {
    method: "post",
    body: JSON.stringify(json),
    headers: {"Content-Type": "application/json"},
    signal,
  });

  const body = await res.text();
  if (!res.ok) {
    throw Error(`${res.status} ${res.statusText}: ${body.slice(0, maxStringLengthToPrint)}`);
  }

  return parseJson(body);
}

/**
 * Util: Parse JSON but display the original source string in case of error
 * Helps debug instances where an API returns a plain text instead of JSON,
 * such as getting an HTML page due to a wrong API URL
 */
function parseJson<T>(json: string): T {
  try {
    return JSON.parse(json);
  } catch (e) {
    throw Error(`Error parsing JSON: ${e.message}\n${json.slice(0, maxStringLengthToPrint)}`);
  }
}
