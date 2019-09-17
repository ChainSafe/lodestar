import Axios, {AxiosResponse, AxiosInstance, AxiosError} from "axios";
import { ILogger } from "../logger";

export interface HttpClientOptions {
  // Add more options if needed
  urlPrefix: string;
}

export class HttpClient {
  private client: AxiosInstance;
  private logger: ILogger;

  public constructor(opt: Partial<HttpClientOptions>, {logger}: {logger: ILogger}) {
    this.client = Axios.create({
      baseURL: opt.urlPrefix || ""
    });
    this.logger = logger;
  }

  public async get<T>(url: string): Promise<T> {
    try {
      const result: AxiosResponse<T> = await this.client.get<T>(url);
      this.logger.debug(`HttpClient GET url=${url} result=${JSON.stringify(result)}`);
      return Promise.resolve(result.data);
    } catch(reason) {
      this.logger.debug(`HttpClient GET error url=${url} reason=${JSON.stringify(reason)}`);
      handleError(reason);
    }
  }

  public async post<T, T2>(url: string, data: T): Promise<T2> {
    try {
      const result: AxiosResponse<any> = await this.client.post(url, data);
      this.logger.debug(`HttpClient POST url=${url} result=${JSON.stringify(result)}`);
      return Promise.resolve(result.data);
    } catch(reason) {
      this.logger.debug(`HttpClient POST error url=${url} reason=${JSON.stringify(reason)}`);
      handleError(reason);
    }
  }
}

const handleError = (error: AxiosError) => {
  let message: string | number;
  if (error.response) {
    message = error.response.status;
  } else if (error.request) {
    message = error.request;
  } else {
    message = error.message;
  }

  throw new Error(message.toString());
}
