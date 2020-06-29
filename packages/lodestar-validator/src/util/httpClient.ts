import Axios, {AxiosError, AxiosInstance, AxiosResponse} from "axios";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import querystring from "querystring";

export interface IHttpClientOptions {
  // Add more options if needed
  urlPrefix: string;
}

export interface IHttpQuery {
  [key: string]: string | number | boolean | string[] | number[];
}

export class HttpClient {
  private client: AxiosInstance;
  private logger: ILogger;

  public constructor(opt: Partial<IHttpClientOptions>, {logger}: {logger: ILogger}) {
    this.client = Axios.create({
      baseURL: opt.urlPrefix || ""
    });
    this.logger = logger;
  }

  public async get<T>(url: string, query?: IHttpQuery): Promise<T> {
    try {
      if (query) url += "?" + querystring.stringify(query);
      const result: AxiosResponse<T> = await this.client.get<T>(url);
      this.logger.verbose(`HttpClient GET url=${url} result=${JSON.stringify(result.data)}`);
      return result.data;
    } catch(reason) {
      this.logger.verbose(`HttpClient GET error url=${url}`);
      throw handleError(reason);
    }
  }

  public async post<T, T2>(url: string, data: T, query?: IHttpQuery): Promise<T2> {
    try {
      if (query) url += "?" + querystring.stringify(query);
      const result: AxiosResponse<T2> = await this.client.post(url, data);
      this.logger.verbose(`HttpClient POST url=${url} result=${JSON.stringify(result.data)}`);
      return result.data;
    } catch(reason) {
      this.logger.verbose(`HttpClient POST error url=${url}`);
      throw handleError(reason);
    }
  }
}

const handleError = (error: AxiosError): AxiosError => {
  if (error.response) {
    if(error.response.status === 404) {
      error.message = "Endpoint not found";
    } else {
      error.message = error.response.data.message || "Request failed with response status " + error.response.status;
    }
  } else if (error.request) {
    error.message = error.request.message;
  }
  error.stack = "";
  return error;
};
