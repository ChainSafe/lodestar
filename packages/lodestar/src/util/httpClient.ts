import Axios, {AxiosResponse, AxiosInstance} from "axios";

export class HttpClient {
  private _client: AxiosInstance;

  public constructor(urlPrefix?: string) {
    const _urlPrefix = urlPrefix? urlPrefix : "";
    this._client = Axios.create({
      baseURL: _urlPrefix
    });
  }

  public get<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      this._client.get<T>(url).then((result: AxiosResponse<T>) => {
        resolve(result.data);
      }).catch((reason: any) => {
        handleError(reason, reject);
      });
    });
  }

  public post<T>(url: string, data: T): Promise<any> {
    return new Promise((resolve, reject) => {
      this._client.post(url, data).then((result: AxiosResponse<any>) => {
        resolve(result.data);
      }).catch((reason: any) => {
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