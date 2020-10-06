import {IBeaconNodeOptionsPartial} from "../options";
import {LogLevel} from "@chainsafe/lodestar-utils";

/* eslint-disable max-len */

// Use a Typescript file instead of JSON so it's automatically included in the built files

export const zinkenConfig: IBeaconNodeOptionsPartial = {
  params: {
    DEPOSIT_CHAIN_ID: 5,
    DEPOSIT_NETWORK_ID: 5,
  },
  api: {
    rest: {
      enabled: true,
    },
  },
  eth1: {
    providerUrl: "https://goerli.prylabs.net",
    depositContractDeployBlock: 3488417,
  },
  logger: {
    chain: {
      level: LogLevel.info,
    },
    db: {
      level: LogLevel.info,
    },
    eth1: {
      level: LogLevel.info,
    },
    node: {
      level: LogLevel.info,
    },
    network: {
      level: LogLevel.info,
    },
    sync: {
      level: LogLevel.info,
    },
    api: {
      level: LogLevel.info,
    },
    metrics: {
      level: LogLevel.info,
    },
    chores: {
      level: LogLevel.info,
    },
  },
  metrics: {
    enabled: true,
    serverPort: 8008,
  },
  network: {
    discv5: {
      // TODO: Add `network.discv5.enabled` to the `IDiscv5DiscoveryInputOptions` type
      // @ts-ignore
      enabled: true,
      bindAddr: "/ip4/0.0.0.0/udp/9000",
      bootEnrs: [
        // TODO: add these when they become available
      ],
    },
    maxPeers: 25,
    bootMultiaddrs: [],
    localMultiaddrs: ["/ip4/0.0.0.0/tcp/9000"],
  },
};
