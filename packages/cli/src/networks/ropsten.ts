import {ropstenChainConfig as chainConfig} from "@lodestar/config/networks";
import {NetworkData} from "./index.js";

export function getNetworkData(): NetworkData {
  return {
    chainConfig,
    depositContractDeployBlock: 12269949,
    genesisFileUrl:
      "https://raw.githubusercontent.com/eth-clients/merge-testnets/main/ropsten-beacon-chain/genesis.ssz",
    bootnodesFileUrl:
      "https://raw.githubusercontent.com/eth-clients/merge-testnets/main/ropsten-beacon-chain/bootstrap_nodes.txt",

    bootEnrs: [],
  };
}
