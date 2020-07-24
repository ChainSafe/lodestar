import {Options} from "yargs";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";

export const networkOptions = {
  "network.discv5.enabled": {
    type: "boolean",
    default: true,
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
    default: [],
    group: "network",
  } as Options,

  "network.maxPeers": {
    type: "number",
    default: 25,
    group: "network",
  } as Options,

  "network.bootMultiaddrs": {
    alias: ["network.bootnodes"],
    type: "array",
    default: [],
    group: "network",
  } as Options,

  "network.localMultiaddrs": {
    alias: ["network.multiaddrs"],
    type: "array",
    default: ["/ip4/0.0.0.0/tcp/30606"],
    group: "network",
  } as Options,
};
