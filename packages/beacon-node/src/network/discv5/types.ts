import {Discv5} from "@chainsafe/discv5";
import {Observable} from "@chainsafe/threads/observable";

// TODO export IDiscv5Config so we don't need this convoluted type
type Discv5Config = Parameters<typeof Discv5["create"]>[0]["config"];

/** discv5 worker constructor data */
export interface Discv5WorkerData {
  enrStr: string;
  peerIdProto: Uint8Array;
  bindAddr: string;
  config: Discv5Config;
  bootEnrs: string[];
  metrics: boolean;
}

/**
 * API exposed by the discv5 worker
 *
 * Note: ENRs are represented as bytes to facilitate message-passing
 */
export type Discv5WorkerApi = {
  /** The current host ENR */
  enrBuf(): Promise<Uint8Array>;
  /** Set a key-value of the current host ENR */
  setEnrValue(key: string, value: Uint8Array): Promise<void>;

  /** Return the ENRs currently in the kad table */
  kadValuesBuf(): Promise<Uint8Array[]>;
  /** Begin a random search through the DHT, return discovered ENRs */
  findRandomNodeBuf(): Promise<Uint8Array[]>;
  /** Stream of discovered ENRs */
  discoveredBuf(): Observable<Uint8Array>;

  /** Prometheus metrics string */
  metrics(): Promise<string>;
  /** tear down discv5 resources */
  close(): Promise<void>;
};
