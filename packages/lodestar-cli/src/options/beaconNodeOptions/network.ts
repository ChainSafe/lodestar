import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions} from "../../util";

export interface INetworkArgs {
  "network.discv5.enabled": boolean;
  "network.discv5.bindAddr": string;
  "network.discv5.bootEnrs": string[];
  "network.maxPeers": number;
  "network.targetPeers": number;
  "network.bootMultiaddrs": string[];
  "network.localMultiaddrs": string[];
}

export function parseArgs(args: INetworkArgs): IBeaconNodeOptions["network"] {
  return {
    // @ts-ignore
    discv5: {
      enabled: args["network.discv5.enabled"],
      bindAddr: args["network.discv5.bindAddr"],
      bootEnrs: args["network.discv5.bootEnrs"],
    },
    maxPeers: args["network.maxPeers"],
    targetPeers: args["network.targetPeers"],
    bootMultiaddrs: args["network.bootMultiaddrs"],
    localMultiaddrs: args["network.localMultiaddrs"],
  };
}

export const options: ICliCommandOptions<INetworkArgs> = {
  "network.discv5.enabled": {
    type: "boolean",
    // TODO: Add `network.discv5.enabled` to the `IDiscv5DiscoveryInputOptions` type
    description: "Enable discv5",
    defaultDescription: String(true),
    group: "network",
  },

  "network.discv5.bindAddr": {
    type: "string",
    description: "Local multiaddress to listen on for discv5",
    defaultDescription: (defaultOptions.network.discv5 || {}).bindAddr || "",
    group: "network",
  },

  "network.discv5.bootEnrs": {
    type: "array",
    description: "Bootnodes for discv5 discovery",
    defaultDescription: JSON.stringify((defaultOptions.network.discv5 || {}).bootEnrs || []),
    group: "network",
  },

  "network.maxPeers": {
    type: "number",
    description: "The maximum number of connections allowed",
    defaultDescription: String(defaultOptions.network.maxPeers),
    group: "network",
  },

  "network.targetPeers": {
    type: "number",
    description: "The target connected peers. Above this number peers will be disconnected",
    defaultDescription: String(defaultOptions.network.targetPeers),
    group: "network",
  },

  "network.bootMultiaddrs": {
    type: "array",
    description: "Libp2p peers to connect to on boot",
    defaultDescription: JSON.stringify(defaultOptions.network.bootMultiaddrs),
    group: "network",
  },

  "network.localMultiaddrs": {
    type: "array",
    description: "Local listening addresses for req/resp and gossip",
    defaultDescription: JSON.stringify(defaultOptions.network.localMultiaddrs),
    group: "network",
  },
};
