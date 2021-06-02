import {IChainConfig} from "@chainsafe/lodestar-config";
import {RecursivePartial} from "@chainsafe/lodestar-utils";
import {ChainEvent} from "../../../src/chain";
import {IBeaconNodeOptions} from "../../../src/node/options";
import {Json} from "@chainsafe/ssz";

export type NodeWorkerOptions = {
  params: Pick<IChainConfig, "SECONDS_PER_SLOT" | "ALTAIR_FORK_EPOCH">;
  options: RecursivePartial<IBeaconNodeOptions>;
  validatorCount: number;
  genesisTime: number;
  nodeIndex: number;
  startIndex: number;
  validatorsPerNode: number;
  checkpointEvent: ChainEvent.justified;
  logFile: string;
  peerIdPrivkey: string;
  nodes: {
    peerIdPrivkey: string;
    localMultiaddrs: string[];
  }[];
};

export enum MessageEvent {
  NodeStarted = "NodeStarted",
}

export type Message =
  | {event: ChainEvent.justified; checkpoint: Json}
  | {event: MessageEvent.NodeStarted; multiaddr: string};
