import Axios, {AxiosResponse, AxiosInstance} from "axios";
import { ILogger } from "../logger";

export interface HttpClientOptions {
  // Add more options if needed
  urlPrefix: string;
}

export class HttpClient {
  private client: AxiosInstance;
  private logger: ILogger;

  public constructor(opt: Partial<HttpClientOptions>, logger: ILogger) {
    this.client = Axios.create({
      baseURL: opt.urlPrefix || ""
    });
    this.logger = logger;
  }

  public get<T>(url: string): Promise<T> {
    return new Promise(async (resolve, reject) => {
      try {
        const result: AxiosResponse<T> = await this.client.get<T>(url);
        this.logger.debug(`HttpClient GET url=${url} result=${JSON.stringify(result)}`);
        resolve(result.data);
      } catch(reason) {
        this.logger.debug(`HttpClient GET error url=${url} reason=${JSON.stringify(reason)}`);
        handleError(reason, reject);
      }
    });
  }

  public post<T, T2>(url: string, data: T): Promise<T2> {
    return new Promise(async (resolve, reject) => {
      try {
        const result: AxiosResponse<any> = await this.client.post(url, data);
        this.logger.debug(`HttpClient POST url=${url} result=${JSON.stringify(result)}`);
        resolve(result.data);
      } catch(reason) {
        this.logger.debug(`HttpClient POST error url=${url} reason=${JSON.stringify(reason)}`);
        handleError(reason, reject);
      }
    });
  }
}

const handleError = (reason, reject) => {
  // Axios always have {response} inside reason
  const err: HttpError = {
    status: reason.response.status,
  }
  if (reason.response.data) {
    const {data} = reason.response;
    err.message = typeof(data) === "string"? data : JSON.stringify(data);
  }
  reject(err);
}

export interface HttpError {
  status: number;
  message?: string;
}