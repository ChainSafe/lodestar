import {IJson, RpcPayload} from "../../eth1/interface.js";
import {IJsonRpcHttpClient} from "../../eth1/provider/jsonRpcHttpClient.js";

export type JsonRpcBackend = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly handlers: Record<string, (...args: any[]) => any>;
};

export class ExecutionEngineMockJsonRpcClient implements IJsonRpcHttpClient {
  constructor(private readonly backend: JsonRpcBackend) {}

  async fetch<R, P = IJson[]>(payload: RpcPayload<P>): Promise<R> {
    const handler = this.backend.handlers[payload.method];
    if (handler === undefined) {
      throw Error(`Unknown method ${payload.method}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return handler(...(payload.params as any[])) as R;
  }

  fetchWithRetries<R, P = IJson[]>(payload: RpcPayload<P>): Promise<R> {
    return this.fetch(payload);
  }

  fetchBatch<R>(rpcPayloadArr: RpcPayload<IJson[]>[]): Promise<R[]> {
    return Promise.all(rpcPayloadArr.map((payload) => this.fetch<R>(payload)));
  }
}
