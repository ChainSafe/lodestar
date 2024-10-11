import axios from "axios";
import {sleep} from "@lodestar/utils";

type Method = "GET" | "POST" | "PUT";

/**
 * Return the status code of a request for given url and method
 */
export async function getReqStatus(url: string, method: Method = "GET"): Promise<number> {
  const res = await axios.request({url, method});
  return res.status;
}

/**
 * Get the response body of a request for given url and method
 */
export async function getRespBody<T = unknown>(
  url: string,
  method: Method = "GET",
  data?: Record<string, unknown>
): Promise<T> {
  const res = await axios.request({url, method, data});
  return res.data as T;
}

/**
 * Match the status code of a request for given url and method
 */
export async function matchReqStatus(url: string, code: number, method: Method = "GET"): Promise<boolean> {
  return (await getReqStatus(url, method)) === code;
}

/**
 * Match the status code of a request for given url and method
 */
export async function matchReqSuccess(url: string, method: Method = "GET"): Promise<boolean> {
  const status = await getReqStatus(url, method);
  return status >= 200 && status < 300;
}

/**
 * Wait for a given endpoint to return a given status code
 */
export async function waitForEndpoint(url: string, statusCode = 200): Promise<void> {
  while (true) {
    const status = await getReqStatus(url);

    if (status === statusCode) {
      break;
    }

    await sleep(1000);
  }
}
