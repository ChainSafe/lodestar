import Axios, {AxiosResponse, AxiosInstance} from "axios";
import { ILogger } from "../logger";

export interface HttpClientOptions {
  // Add more options if needed
  urlPrefix?: string;
}

export class HttpClient {
  private client: AxiosInstance;
  private logger: ILogger;

  public constructor(opt: HttpClientOptions, logger: ILogger) {
    this.client = Axios.create({
      baseURL: opt.urlPrefix || ""
    });
    this.logger = logger;
  }

  public get<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      this.client.get<T>(url).then((result: AxiosResponse<T>) => {
        this.logger.debug(`HttpClient GET url=${url} result=${JSON.stringify(result)}`);
        resolve(result.data);
      }).catch((reason: any) => {
        this.logger.debug(`HttpClient GET error url=${url} reason=${JSON.stringify(reason)}`);
        handleError(reason, reject);
      });
    });
  }

  public post<T, T2>(url: string, data: T): Promise<T2> {
    return new Promise((resolve, reject) => {
      this.client.post(url, data).then((result: AxiosResponse<any>) => {
        this.logger.debug(`HttpClient POST url=${url} result=${JSON.stringify(result)}`);
        resolve(result.data);
      }).catch((reason: any) => {
        this.logger.debug(`HttpClient POST error url=${url} reason=${JSON.stringify(reason)}`);
        handleError(reason, reject);
      });
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