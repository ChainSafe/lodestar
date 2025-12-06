import {Discv5} from "@chainsafe/discv5";
import {ENRData, SignableENRData} from "@chainsafe/enr";
import {ChainConfig} from "@lodestar/config";
import {LoggerNodeOpts} from "@lodestar/logger/node";

// TODO export IDiscv5Config so we don't need this convoluted type
type Discv5Config = Parameters<(typeof Discv5)["create"]>[0]["config"];

type BindAddrs =
  | {
      ip4: string;
      ip6?: string;
    }
  | {
      ip4?: string;
      ip6: string;
    }
  | {
      ip4: string;
      ip6: string;
    };

export type LodestarDiscv5Opts = {
  config?: Discv5Config;
  enr: string;
  bindAddrs: BindAddrs;
  bootEnrs: string[];
};

/** discv5 worker constructor data */
export interface Discv5WorkerData {
  enr: string;
  privateKeyProto: Uint8Array;
  bindAddrs: BindAddrs;
  config: Discv5Config;
  bootEnrs: string[];
  metrics: boolean;
  chainConfig: ChainConfig;
  genesisValidatorsRoot: Uint8Array;
  loggerOpts: LoggerNodeOpts;
  genesisTime: number;
}

/**
 * Messages sent from main thread to worker
 */
export type Discv5WorkerMessage =
  | {type: "enr"; id: number}
  | {type: "setEnrValue"; id: number; key: string; value: Uint8Array}
  | {type: "kadValues"; id: number}
  | {type: "discoverKadValues"; id: number}
  | {type: "findRandomNode"; id: number}
  | {type: "scrapeMetrics"; id: number}
  | {type: "writeProfile"; id: number; durationMs: number; dirpath: string}
  | {type: "writeHeapSnapshot"; id: number; prefix: string; dirpath: string}
  | {type: "close"; id: number};

/**
 * Messages sent from worker to main thread
 */
export type Discv5WorkerResponse =
  | {type: "discovered"; enr: ENRData}
  | {type: "enr"; id: number; enr: SignableENRData}
  | {type: "setEnrValue"; id: number}
  | {type: "kadValues"; id: number; enrs: ENRData[]}
  | {type: "discoverKadValues"; id: number}
  | {type: "findRandomNode"; id: number; enrs: ENRData[]}
  | {type: "scrapeMetrics"; id: number; metrics: string}
  | {type: "writeProfile"; id: number; path: string}
  | {type: "writeHeapSnapshot"; id: number; path: string}
  | {type: "close"; id: number}
  | {type: "error"; id: number; error: {message: string; stack?: string}};
