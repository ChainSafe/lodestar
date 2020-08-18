import {Options} from "yargs";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";

export const networkOptions = {
  "network.discv5.enabled": {
    type: "boolean",
    // TODO: Add `network.discv5.enabled` to the `IDiscv5DiscoveryInputOptions` type
    description: "Enable discv5",
    defaultDescription: String(true),
    group: "network",
  } as Options,

  "network.discv5.bindAddr": {
    type: "string",
    description: "Local multiaddress to listen on for discv5",
    defaultDescription: (defaultOptions.network.discv5 || {}).bindAddr || "",
    group: "network",
  } as Options,

  "network.discv5.bootEnrs": {
    type: "array",
    description: "Bootnodes for discv5 discovery",
    defaultDescription: JSON.stringify((defaultOptions.network.discv5 || {}).bootEnrs || []),
    group: "network",
  } as Options,

  "network.maxPeers": {
    type: "number",
    description: "Maximum # of peers who can connect",
    defaultDescription: String(defaultOptions.network.maxPeers),
    group: "network",
  } as Options,

  "network.bootnodes": {
    type: "array",
    description: "Libp2p peers to connect to on boot",
    defaultDescription: JSON.stringify(defaultOptions.network.bootnodes),
    group: "network",
  } as Options,

  "network.multiaddrs": {
    type: "array",
    description: "Local listening addresses for req/resp and gossip",
    defaultDescription: JSON.stringify(defaultOptions.network.multiaddrs),
    group: "network",
  } as Options,
};
