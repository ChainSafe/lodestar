export type IJson = string | number | boolean | undefined | IJson[] | {[key: string]: IJson};

export interface IRpcPayload<P = IJson[]> {
  method: string;
  params: P;
}