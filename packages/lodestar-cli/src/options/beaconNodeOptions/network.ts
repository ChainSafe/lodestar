import {Options} from "yargs";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";

export const networkOptions = {
  "network.discv5.enabled": {
    type: "boolean",
    // TODO: Add `network.discv5.enabled` to the `IDiscv5DiscoveryInputOptions` type
    defaultDescription: String(true),
    group: "network",
  } as Options,

  "network.discv5.bindAddr": {
    type: "string",
    defaultDescription: (defaultOptions.network.discv5 || {}).bindAddr || "",
    group: "network",
  } as Options,

  "network.discv5.bootEnrs": {
    type: "array",
    defaultDescription: JSON.stringify((defaultOptions.network.discv5 || {}).bootEnrs || []),
    group: "network",
  } as Options,

  "network.maxPeers": {
    type: "number",
    defaultDescription: String(defaultOptions.network.maxPeers),
    group: "network",
  } as Options,

  "network.bootnodes": {
    type: "array",
    defaultDescription: JSON.stringify(defaultOptions.network.bootnodes),
    group: "network",
  } as Options,

  "network.multiaddrs": {
    type: "array",
    defaultDescription: JSON.stringify(defaultOptions.network.multiaddrs),
    group: "network",
  } as Options,
};
