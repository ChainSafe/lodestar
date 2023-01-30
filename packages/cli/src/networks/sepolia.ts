import {sepoliaChainConfig as chainConfig} from "@lodestar/config/networks";
import {NetworkData} from "./index.js";

export function getNetworkData(): NetworkData {
  return {
    chainConfig,
    depositContractDeployBlock: 1273020,
    genesisFileUrl: "https://raw.githubusercontent.com/eth-clients/merge-testnets/main/sepolia/genesis.ssz",
    bootnodesFileUrl: "https://raw.githubusercontent.com/eth-clients/merge-testnets/main/sepolia/bootstrap_nodes.txt",

    bootEnrs: [
      "enr:-Iq4QMCTfIMXnow27baRUb35Q8iiFHSIDBJh6hQM5Axohhf4b6Kr_cOCu0htQ5WvVqKvFgY28893DHAg8gnBAXsAVqmGAX53x8JggmlkgnY0gmlwhLKAlv6Jc2VjcDI1NmsxoQK6S-Cii_KmfFdUJL2TANL3ksaKUnNXvTCv1tLwXs0QgIN1ZHCCIyk",
    ],
  };
}
