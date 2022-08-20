import {defaultOptions, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {ICliCommandOptions} from "../../util/index.js";

const defaultListenAddress = "0.0.0.0";

export interface INetworkArgs {
  discv5?: boolean;
  listenAddress?: string;
  port?: number;
  discoveryPort?: number;
  bootnodes?: string[];
  targetPeers: number;
  subscribeAllSubnets: boolean;
  "network.maxPeers": number;
  "network.connectToDiscv5Bootnodes": boolean;
  "network.discv5FirstQueryDelayMs": number;
  "network.requestCountPeerLimit": number;
  "network.blockCountTotalLimit": number;
  "network.blockCountPeerLimit": number;
  "network.rateTrackerTimeoutMs": number;
  "network.dontSendGossipAttestationsToForkchoice": boolean;
  "network.allowPublishToZeroPeers": boolean;
}

export function parseArgs(args: INetworkArgs): IBeaconNodeOptions["network"] {
  const listenAddress = args.listenAddress || defaultListenAddress;
  const udpPort = args.discoveryPort ?? args.port ?? 9000;
  const tcpPort = args.port ?? 9000;

  return {
    discv5: {
      enabled: args["discv5"] ?? true,
      bindAddr: `/ip4/${listenAddress}/udp/${udpPort}`,
      // TODO: Okay to set to empty array?
      bootEnrs: args["bootnodes"] ?? [],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
      enr: undefined as any,
    },
    maxPeers: args["network.maxPeers"],
    targetPeers: args["targetPeers"],
    localMultiaddrs: [`/ip4/${listenAddress}/tcp/${tcpPort}`],
    subscribeAllSubnets: args["subscribeAllSubnets"],
    connectToDiscv5Bootnodes: args["network.connectToDiscv5Bootnodes"],
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
    defaultDescription: String(true),
    group: "network",
  },

  listenAddress: {
    type: "string",
    description: "The address to listen for p2p UDP and TCP connections",
    defaultDescription: defaultListenAddress,
    group: "network",
  },

  port: {
    description: "The TCP/UDP port to listen on. The UDP port can be modified by the --discovery-port flag.",
    type: "number",
    // TODO: Derive from BeaconNode defaults
    defaultDescription: "9000",
    group: "network",
  },

  discoveryPort: {
    description: "The UDP port that discovery will listen on. Defaults to `port`",
    type: "number",
    defaultDescription: "`port`",
    group: "network",
  },

  bootnodes: {
    type: "array",
    description: "Bootnodes for discv5 discovery",
    defaultDescription: JSON.stringify((defaultOptions.network.discv5 || {}).bootEnrs || []),
    group: "network",
  },

  targetPeers: {
    type: "number",
    description: "The target connected peers. Above this number peers will be disconnected",
    defaultDescription: String(defaultOptions.network.targetPeers),
    group: "network",
  },

  subscribeAllSubnets: {
    type: "boolean",
    description: "Subscribe to all subnets regardless of validator count",
    defaultDescription: String(defaultOptions.network.subscribeAllSubnets === true),
    group: "network",
  },

  "network.maxPeers": {
    hidden: true,
    type: "number",
    description: "The maximum number of connections allowed",
    defaultDescription: String(defaultOptions.network.maxPeers),
    group: "network",
  },

  "network.connectToDiscv5Bootnodes": {
    type: "boolean",
    description: "Attempt direct connection to discv5 bootnodes from network.discv5.bootEnrs option",
    hidden: true,
    defaultDescription: String(defaultOptions.network.connectToDiscv5Bootnodes === true),
    group: "network",
  },

  "network.discv5FirstQueryDelayMs": {
    type: "number",
    description: "Delay the 1st heart beat of Peer Manager after starting Discv5",
    hidden: true,
    defaultDescription: String(defaultOptions.network.discv5FirstQueryDelayMs),
    group: "network",
  },

  "network.requestCountPeerLimit": {
    type: "number",
    description: "Max block req/resp requests per peer per rateTrackerTimeoutMs",
    hidden: true,
    defaultDescription: String(defaultOptions.network.requestCountPeerLimit),
    group: "network",
  },

  "network.blockCountTotalLimit": {
    type: "number",
    description: "Max block count requested per rateTrackerTimeoutMs",
    hidden: true,
    defaultDescription: String(defaultOptions.network.blockCountTotalLimit),
    group: "network",
  },

  "network.blockCountPeerLimit": {
    type: "number",
    description: "Max block count requested per peer per rateTrackerTimeoutMs",
    hidden: true,
    defaultDescription: String(defaultOptions.network.blockCountPeerLimit),
    group: "network",
  },

  "network.rateTrackerTimeoutMs": {
    type: "number",
    description: "Time window to track rate limit in milli seconds",
    hidden: true,
    defaultDescription: String(defaultOptions.network.rateTrackerTimeoutMs),
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
