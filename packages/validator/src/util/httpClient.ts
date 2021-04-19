import Axios, {AxiosError, AxiosInstance, AxiosResponse, CancelToken, Method} from "axios";
import querystring from "querystring";
import {AbortSignal} from "abort-controller";
import {BLSPubkey, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ValidatorStatus} from "@chainsafe/lodestar-types/phase0";
import {ErrorAborted} from "@chainsafe/lodestar-utils";

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

export interface IValidatorFilters {
  indices?: (BLSPubkey | ValidatorIndex)[];
  statuses?: ValidatorStatus[];
}

export interface IHttpClientOptions {
  baseUrl: string;
  timeout?: number;
}

export interface IHttpQuery {
  [key: string]: string | number | boolean | string[] | number[];
}

export class HttpClient {
  readonly baseUrl: string;
  private client: AxiosInstance;
  private cancelToken?: CancelToken;

  constructor(opt: IHttpClientOptions) {
    this.baseUrl = opt.baseUrl;
    this.client = Axios.create({
      baseURL: opt.baseUrl,
      timeout: opt.timeout,
    });
  }

  registerAbortSignal(signal: AbortSignal): void {
    const source = Axios.CancelToken.source();
    signal.addEventListener("abort", () => source.cancel("Aborted"), {once: true});
    this.cancelToken = source.token;
  }

  async get<T>(url: string, query?: IHttpQuery): Promise<T> {
    return this.request(url, "GET", query);
  }

  async post<T, T2>(url: string, data: T, query?: IHttpQuery): Promise<T2> {
    return this.request(url, "POST", query, data);
  }

  async request<T, T2>(url: string, method: Method, query?: IHttpQuery, data?: T): Promise<T2> {
    try {
      if (query) {
        url += "?" + querystring.stringify(query);
      }

      const result: AxiosResponse<T2> = await this.client.request({
        method,
        url,
        data,
        cancelToken: this.cancelToken,
      });
      return result.data;
    } catch (e) {
      if (Axios.isCancel(e)) {
        throw new ErrorAborted("Validator REST client");
      }
      throw this.handleError(e);
    }
  }

  private handleError = (error: AxiosError & NodeJS.ErrnoException): Error => {
    if (error.response) {
      if (error.response.status === 404) {
        error.message = "Endpoint not found";
        if (error.request && error.request.path) {
          error.message += `: ${error.request.path}`;
        }
      } else {
        error.message = error.response.data.message || "Request failed with response status " + error.response.status;
      }
    } else if (error.request) {
      if (error.syscall && error.errno)
        error.message = error.syscall + " " + error.errno + " " + error.request._currentUrl;
    }
    error.stack = "";
    return error;
  };
}
