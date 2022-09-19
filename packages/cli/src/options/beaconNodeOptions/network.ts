import {defaultOptions, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {ICliCommandOptions} from "../../util/index.js";

export interface INetworkArgs {
  discv5?: boolean;
  listenAddress?: string;
  port?: number;
  discoveryPort?: number;
  bootnodes?: string[];
  targetPeers?: number;
  subscribeAllSubnets?: boolean;
  "network.maxPeers"?: number;
  "network.connectToBootnodes"?: boolean;
  "network.discv5FirstQueryDelayMs"?: number;
  "network.requestCountPeerLimit"?: number;
  "network.blockCountTotalLimit"?: number;
  "network.blockCountPeerLimit"?: number;
  "network.rateTrackerTimeoutMs"?: number;
  "network.dontSendGossipAttestationsToForkchoice"?: boolean;
  "network.allowPublishToZeroPeers"?: boolean;
}

export function parseArgs(args: INetworkArgs): IBeaconNodeOptions["network"] {
  return {
    discv5: args["discv5"],
    listenAddress: args["listenAddress"],
    port: args["port"],
    discoveryPort: args["discoveryPort"],
    bootnodes: args["bootnodes"],
    targetPeers: args["targetPeers"],
    maxPeers: args["network.maxPeers"],
    subscribeAllSubnets: args["subscribeAllSubnets"],

    connectToBootnodes: args["network.connectToBootnodes"],
    discv5FirstQueryDelayMs: args["network.discv5FirstQueryDelayMs"],
    requestCountPeerLimit: args["network.requestCountPeerLimit"],
    blockCountTotalLimit: args["network.blockCountTotalLimit"],
    blockCountPeerLimit: args["network.blockCountPeerLimit"],
    rateTrackerTimeoutMs: args["network.rateTrackerTimeoutMs"],
    dontSendGossipAttestationsToForkchoice: args["network.dontSendGossipAttestationsToForkchoice"],
    allowPublishToZeroPeers: args["network.allowPublishToZeroPeers"],
  };
}

export const options: ICliCommandOptions<INetworkArgs> = {
  discv5: {
    type: "boolean",
    // TODO: Add `network.discv5.enabled` to the `IDiscv5DiscoveryInputOptions` type
    description: "Enable discv5",
    defaultDescription: String(defaultOptions.network.discv5 as boolean),
    group: "network",
  },

  listenAddress: {
    type: "string",
    description: "The address to listen for p2p UDP and TCP connections",
    defaultDescription: defaultOptions.network.listenAddress,
    group: "network",
  },

  port: {
    description: "The TCP/UDP port to listen on. The UDP port can be modified by the --discovery-port flag.",
    type: "number",
    // TODO: Derive from BeaconNode defaults
    defaultDescription: String(defaultOptions.network.port as number),
    group: "network",
  },

  discoveryPort: {
    description: "The UDP port that discovery will listen on. Defaults to `port`",
    type: "number",
    defaultDescription: String(defaultOptions.network.discoveryPort as number),
    group: "network",
  },

  bootnodes: {
    type: "array",
    description: "Bootnodes for discv5 discovery",
    group: "network",
  },

  targetPeers: {
    type: "number",
    description: "The target connected peers. Above this number peers will be disconnected",
    defaultDescription: String(defaultOptions.network.targetPeers as number),
    group: "network",
  },

  subscribeAllSubnets: {
    type: "boolean",
    description: "Subscribe to all subnets regardless of validator count",
    group: "network",
  },

  "network.maxPeers": {
    hidden: true,
    type: "number",
    description: "The maximum number of connections allowed",
    group: "network",
  },

  "network.connectToBootnodes": {
    type: "boolean",
    description: "Attempt direct connection to discv5 bootnodes from network.discv5.bootEnrs option",
    hidden: true,
    alias: ["network.connectToDiscv5Bootnodes"], // backwards compatibility
    group: "network",
  },

  "network.discv5FirstQueryDelayMs": {
    type: "number",
    description: "Delay the 1st heart beat of Peer Manager after starting Discv5",
    hidden: true,
    group: "network",
  },

  "network.requestCountPeerLimit": {
    type: "number",
    description: "Max block req/resp requests per peer per rateTrackerTimeoutMs",
    hidden: true,
    group: "network",
  },

  "network.blockCountTotalLimit": {
    type: "number",
    description: "Max block count requested per rateTrackerTimeoutMs",
    hidden: true,
    group: "network",
  },

  "network.blockCountPeerLimit": {
    type: "number",
    description: "Max block count requested per peer per rateTrackerTimeoutMs",
    hidden: true,
    group: "network",
  },

  "network.rateTrackerTimeoutMs": {
    type: "number",
    description: "Time window to track rate limit in milli seconds",
    hidden: true,
    group: "network",
  },

  "network.dontSendGossipAttestationsToForkchoice": {
    hidden: true,
    type: "boolean",
    description: "Pass gossip attestations to forkchoice or not",
    group: "network",
  },

  "network.allowPublishToZeroPeers": {
    hidden: true,
    type: "boolean",
    description: "Don't error when publishing to zero peers",
    group: "network",
  },
};
