// JSON RPC interface types extracted from eth1/interface.js

export type IJson = string | number | boolean | undefined | IJson[] | {[key: string]: IJson};

export interface RpcPayload<P = IJson[]> {
  method: string;
  params: P;
}
