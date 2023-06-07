import {Discv5, ENR, ENRData, SignableENRData} from "@chainsafe/discv5";
import {ChainConfig} from "@lodestar/config";
import {LoggerNodeOpts} from "@lodestar/logger/node";
import {EventDirection} from "../../util/workerEvents.js";

// TODO export IDiscv5Config so we don't need this convoluted type
type Discv5Config = Parameters<(typeof Discv5)["create"]>[0]["config"];

export type LodestarDiscv5Opts = {
  config?: Discv5Config;
  enr: string;
  bindAddr: string;
  bootEnrs: string[];
};

/** discv5 worker constructor data */
export interface Discv5WorkerData {
  enr: string;
  peerIdProto: Uint8Array;
  bindAddr: string;
  config: Discv5Config;
  bootEnrs: string[];
  metrics: boolean;
  chainConfig: ChainConfig;
  genesisValidatorsRoot: Uint8Array;
  loggerOpts: LoggerNodeOpts;
}

/**
 * API exposed by the discv5 worker
 *
 * Note: ENRs are represented as bytes to facilitate message-passing
 */
export type Discv5WorkerApi = {
  /** The current host ENR */
  enr(): Promise<SignableENRData>;
  /** Set a key-value of the current host ENR */
  setEnrValue(key: string, value: Uint8Array): Promise<void>;

  /** Return the ENRs currently in the kad table */
  kadValues(): Promise<ENRData[]>;
  /** emit the ENRs currently in the kad table */
  discoverKadValues(): Promise<void>;
  /** Begin a random search through the DHT, return discovered ENRs */
  findRandomNode(): Promise<ENRData[]>;

  /** Prometheus metrics string */
  scrapeMetrics(): Promise<string>;
  /** tear down discv5 resources */
  close(): Promise<void>;
};

export const DISCV5_WORKER_EVENTID = "discv5WorkerEvent";

export enum Discv5WorkerEvent {
  discoveredENR = "discv5-worker.discoveredENR",
}

export type Discv5WorkerEventData = {
  [Discv5WorkerEvent.discoveredENR]: ENR;
};

export const discv5WorkerEventDirection: Record<Discv5WorkerEvent, EventDirection> = {
  [Discv5WorkerEvent.discoveredENR]: EventDirection.workerToMain,
};
