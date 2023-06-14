import axios from "axios";
import {sleep} from "@lodestar/utils";

type Method = "GET" | "POST" | "PUT";

export async function getReqStatus(url: string, method: Method = "GET"): Promise<number> {
  const res = await axios.request({url, method});
  return res.status;
}

export async function getReqBody<T = unknown>(
  url: string,
  method: Method = "GET",
  data?: Record<string, unknown>
): Promise<T> {
  const res = await axios.request({url, method, data});
  return res.data as T;
}

export async function matchReqStatus(url: string, code: number, method: Method = "GET"): Promise<boolean> {
  return (await getReqStatus(url, method)) === code;
}

export async function matchReqSuccess(url: string, method: Method = "GET"): Promise<boolean> {
  const status = await getReqStatus(url, method);
  return status >= 200 && status < 300;
}

export async function waitForEndpoint(url: string, statusCode = 200): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await getReqStatus(url);

    if (status === statusCode) {
      break;
    }

    await sleep(1000);
  }
}
