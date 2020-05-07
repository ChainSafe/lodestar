import {Options} from "yargs";

export const discv5Enabled: Options = {
  alias: [
    "network.discv5.enabled",
  ],
  type: "boolean",
  default: true,
  group: "network",
};

export const discv5BindAddr: Options = {
  alias: [
    "network.discv5.bindAddr",
  ],
  type: "string",
  default: "/ip4/0.0.0.0/udp/9000",
  group: "network",
};

export const discv5BootEnrs: Options = {
  alias: [
    "network.discv5.bootEnrs",
  ],
  type: "array",
  default: [],
  group: "network",
};



export const networkMaxPeers: Options = {
  alias: [
    "network.maxPeers",
  ],
  type: "number",
  default: 25,
  group: "network",
};

export const networkBootMultiaddrs: Options = {
  alias: [
    "network.bootMultiaddrs",
    "network.bootnodes",
  ],
  type: "array",
  default: [],
  group: "network",
};

export const networkLocalMultiaddrs: Options = {
  alias: [
    "network.localMultiaddrs",
    "network.multiaddrs",
  ],
  type: "array",
  default: [
    "/ip4/0.0.0.0/tcp/30606"
  ],
  group: "network",
};
