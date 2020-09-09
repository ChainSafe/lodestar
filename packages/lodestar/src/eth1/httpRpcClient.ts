// Uses isomorphic-fetch for browser + NodeJS cross compatibility
import fetch from "isomorphic-fetch";
import {AbortSignal} from "abort-controller";

interface IRpcPayload {
  method: string;
  params: (string | number | boolean)[];
}

interface IRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result: T;
}

/**
 * Limits the amount of response text printed with RPC or parsing errors
 */
const maxStringLengthToPrint = 500;

/**
 * Perform RPC request
 * @param url
 * @param rpcPayload
 */
export async function fetchRpc<R>(url: string, rpcPayload: IRpcPayload, signal?: AbortSignal): Promise<R> {
  const data: IRpcResponse<R> = await fetchJson(
    url,
    {
      jsonrpc: "2.0",
      method: rpcPayload.method,
      params: rpcPayload.params,
      id: 1,
    },
    signal
  );
  return data.result;
}

/**
 * Perform RPC batched request
 * Type-wise assumes all requests results have the same type
 * @param url
 * @param rpcPayloadArr
 */
export async function fetchRpcBatch<R>(url: string, rpcPayloadArr: IRpcPayload[], signal?: AbortSignal): Promise<R[]> {
  const dataArr: IRpcResponse<R>[] = await fetchJson(
    url,
    rpcPayloadArr.map((rpcPayload, i) => ({
      jsonrpc: "2.0",
      method: rpcPayload.method,
      params: rpcPayload.params,
      id: i,
    })),
    signal
  );
  return dataArr.map((data) => data.result);
}

/**
 * Fetches JSON and throws detailed errors in case the HTTP request is not ok
 * @param url
 * @param json
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
 * @param json
 */
function parseJson<T>(json: string): T {
  try {
    return JSON.parse(json);
  } catch (e) {
    throw Error(`Error parsing JSON: ${e.message}\n${json.slice(0, maxStringLengthToPrint)}`);
  }
}
