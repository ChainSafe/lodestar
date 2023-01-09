import {Discv5} from "@chainsafe/discv5";
import {Observable} from "@chainsafe/threads/observable";

// TODO export IDiscv5Config so we don't need this convoluted type
type Discv5Config = Parameters<typeof Discv5["create"]>[0]["config"];
export interface Discv5WorkerData {
  enrStr: string;
  peerIdProto: Uint8Array;
  bindAddr: string;
  config: Discv5Config;
  bootEnrs: string[];
  metrics: boolean;
}

export type Discv5WorkerApi = {
  enrBuf(): Promise<Uint8Array>;
  setEnrValue(key: string, value: Uint8Array): Promise<void>;

  kadValuesBuf(): Promise<Uint8Array[]>;
  findRandomNodeBuf(): Promise<Uint8Array[]>;
  discoveredBuf(): Observable<Uint8Array>;

  metrics(): Promise<string>;
  close(): Promise<void>;
};
