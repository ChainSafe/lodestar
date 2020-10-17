import defaultOptions, {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {ICliCommandOptions} from "../../util";

export interface IBeaconNodeNetworkArgs {
  "network.discv5.enabled": boolean;
  "network.discv5.bindAddr": string;
  "network.discv5.bootEnrs": string[];
  "network.maxPeers": number;
  "network.bootMultiaddrs": string[];
  "network.localMultiaddrs": string[];
}

export function toNetworkOptions(args: IBeaconNodeNetworkArgs): IBeaconNodeOptions["network"] {
  return {
    discv5: {
      // ### TODO: declare discv5.enable in its types
      // @ts-ignore
      enabled: args["network.discv5.enabled"],
      bindAddr: args["network.discv5.bindAddr"],
      bootEnrs: args["network.discv5.bootEnrs"],
    },
    maxPeers: args["network.maxPeers"],
    bootMultiaddrs: args["network.bootMultiaddrs"],
    localMultiaddrs: args["network.localMultiaddrs"],
  };
}

export const networkOptions: ICliCommandOptions<IBeaconNodeNetworkArgs> = {
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
    description: "Maximum # of peers who can connect",
    defaultDescription: String(defaultOptions.network.maxPeers),
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
