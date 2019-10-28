import Axios, {AxiosError, AxiosInstance, AxiosResponse} from "axios";
import {ILogger} from "../logger/interface";

export interface IHttpClientOptions {
  // Add more options if needed
  urlPrefix: string;
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

  public async get<T>(url: string): Promise<T> {
    try {
      const result: AxiosResponse<T> = await this.client.get<T>(url);
      this.logger.verbose(`HttpClient GET url=${url} result=${JSON.stringify(result)}`);
      return result.data;
    } catch(reason) {
      this.logger.verbose(`HttpClient GET error url=${url} reason=${JSON.stringify(reason)}`);
      throw handleError(reason);
    }
  }

  public async post<T, T2>(url: string, data: T): Promise<T2> {
    try {
      const result: AxiosResponse<T2> = await this.client.post(url, data);
      this.logger.verbose(`HttpClient POST url=${url} result=${JSON.stringify(result)}`);
      return result.data;
    } catch(reason) {
      this.logger.verbose(`HttpClient POST error url=${url} reason=${JSON.stringify(reason)}`);
      throw handleError(reason);
    }
  }
}

const handleError = (error: AxiosError): Error => {
  let message: string | number;
  if (error.response) {
    message = error.response.status;
  } else if (error.request) {
    message = error.request;
  } else {
    message = error.message;
  }

  return new Error(message.toString());
};
