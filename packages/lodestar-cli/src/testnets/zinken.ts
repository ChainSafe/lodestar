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
        "enr:-KG4QHPtVnKHEOkEJT1f5C6Hs-C_c4SlipTfkPrDIikLTzhqA_3m6bTq-CirsljlVP4IJybXelHE7J3l9DojR14_ZHUGhGV0aDKQ2jUIggAAAAP__________4JpZIJ2NIJpcIQSv2qciXNlY3AyNTZrMaECi_CNPDkKPilhimY7aEY-mBtSzI8AKMDvvv_I2Un74_qDdGNwgiMog3VkcIIjKA",
        "enr:-Ku4QH63huZ12miIY0kLI9dunG5fwKpnn-zR3XyA_kH6rQpRD1VoyLyzIcFysCJ09JDprdX-EzXp-Nc8swYqBznkXggBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpDaNQiCAAAAA___________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQILqxBY-_SF8o_5FjFD3yM92s50zT_ciFi8hStde5AEjIN1ZHCCH0A",
      ],
    },
    maxPeers: 25,
    bootMultiaddrs: [],
    localMultiaddrs: ["/ip4/0.0.0.0/tcp/9000"],
  },
};
