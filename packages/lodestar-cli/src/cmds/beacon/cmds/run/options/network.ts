import {IYargsOptionsMap} from "../../../../../util/yargs";

export const networkOptions: IYargsOptionsMap = {
  "network.discv5.enabled": {
    type: "boolean",
    default: true,
    group: "network",
  },

  "network.discv5.bindAddr": {
    type: "string",
    default: "/ip4/0.0.0.0/udp/9000",
    group: "network",
  },

  "network.discv5.bootEnrs": {
    type: "array",
    default: [],
    group: "network",
  },

  "network.maxPeers": {
    type: "number",
    default: 25,
    group: "network",
  },

  "network.bootMultiaddrs": {
    alias: ["network.bootnodes"],
    type: "array",
    default: [],
    group: "network",
  },

  "network.localMultiaddrs": {
    alias: ["network.multiaddrs"],
    type: "array",
    default: ["/ip4/0.0.0.0/tcp/30606"],
    group: "network",
  },
};
